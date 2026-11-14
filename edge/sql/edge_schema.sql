-- =============================================================================
--  edge_schema.sql : on-device offline cache (SQLite 3.35+ with R*Tree + JSON1)
--
--  Android: bundle requery/sqlite-android (or SpatiaLite) so R*Tree and JSON1 are
--  guaranteed regardless of the OEM's system SQLite build. If R*Tree is somehow
--  unavailable, the gh7 column + index below is a portable fallback.
-- =============================================================================
PRAGMA journal_mode = WAL;       -- reader (alert loop) never blocks writer (sync)
PRAGMA synchronous  = NORMAL;
PRAGMA foreign_keys = ON;

-- Hazards mirrored from the server (only rider-relevant, live rows)
CREATE TABLE IF NOT EXISTS hazards (
  rid               INTEGER PRIMARY KEY,           -- rowid shared with the R*Tree
  id                TEXT    NOT NULL UNIQUE,       -- server uuid
  hazard_type       TEXT    NOT NULL,
  lat               REAL    NOT NULL,
  lon               REAL    NOT NULL,
  extent_geojson    TEXT,                          -- LineString for stretches
  bearing_deg       INTEGER,
  severity          TEXT    NOT NULL CHECK (severity IN ('info','warning','critical')),
  status            TEXT    NOT NULL,
  trust_tier        INTEGER NOT NULL,
  confidence        REAL    NOT NULL,
  active_when       TEXT    NOT NULL DEFAULT 'always',
  two_wheeler_boost INTEGER NOT NULL DEFAULT 0,
  expires_at_ms     INTEGER,                       -- epoch ms; NULL = no expiry
  tile_gh5          TEXT    NOT NULL,
  gh7               TEXT    NOT NULL,              -- fallback index (~150 m cells)
  sync_version      INTEGER NOT NULL,
  local_only        INTEGER NOT NULL DEFAULT 0,    -- rider's own unsynced report (shown immediately)
  -- bounding box of the extent for stretches (NULL for point hazards)
  bbox_min_lat      REAL, bbox_max_lat REAL, bbox_min_lon REAL, bbox_max_lon REAL
);
CREATE INDEX IF NOT EXISTS hazards_gh7_idx  ON hazards (gh7);
CREATE INDEX IF NOT EXISTS hazards_tile_idx ON hazards (tile_gh5);

-- Bounding-box spatial index (lat/lon degrees). For stretches the box covers the extent.
CREATE VIRTUAL TABLE IF NOT EXISTS hazards_rtree USING rtree(
  rid, min_lat, max_lat, min_lon, max_lon
);

-- Keep the R*Tree in step with the table. Stretches index their extent's bbox;
-- point hazards use a zero-size box.
CREATE TRIGGER IF NOT EXISTS hazards_ai AFTER INSERT ON hazards BEGIN
  INSERT INTO hazards_rtree VALUES (NEW.rid,
    coalesce(NEW.bbox_min_lat, NEW.lat), coalesce(NEW.bbox_max_lat, NEW.lat),
    coalesce(NEW.bbox_min_lon, NEW.lon), coalesce(NEW.bbox_max_lon, NEW.lon));
END;
CREATE TRIGGER IF NOT EXISTS hazards_au
AFTER UPDATE OF lat, lon, bbox_min_lat, bbox_max_lat, bbox_min_lon, bbox_max_lon ON hazards BEGIN
  UPDATE hazards_rtree
     SET min_lat = coalesce(NEW.bbox_min_lat, NEW.lat), max_lat = coalesce(NEW.bbox_max_lat, NEW.lat),
         min_lon = coalesce(NEW.bbox_min_lon, NEW.lon), max_lon = coalesce(NEW.bbox_max_lon, NEW.lon)
   WHERE rid = NEW.rid;
END;
CREATE TRIGGER IF NOT EXISTS hazards_ad AFTER DELETE ON hazards BEGIN
  DELETE FROM hazards_rtree WHERE rid = OLD.rid;
END;

-- Which tiles are cached, and how fresh
CREATE TABLE IF NOT EXISTS tiles (
  gh5               TEXT PRIMARY KEY,
  last_sync_version INTEGER NOT NULL DEFAULT 0,
  fetched_at_ms     INTEGER NOT NULL,
  pinned            INTEGER NOT NULL DEFAULT 0   -- 1 = home/work region, never evicted
);

-- Offline outbox: reports, votes, pass reports, telemetry. Replayed idempotently.
CREATE TABLE IF NOT EXISTS outbox (
  id               TEXT PRIMARY KEY,              -- uuid v4 generated on device
  kind             TEXT NOT NULL CHECK (kind IN ('report','vote','pass','telemetry')),
  payload_json     TEXT NOT NULL,
  created_at_ms    INTEGER NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_ms  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS outbox_due_idx ON outbox (next_attempt_ms);

-- Per-hazard familiarity: drives anti-fatigue downgrades on daily routes
CREATE TABLE IF NOT EXISTS familiarity (
  hazard_id     TEXT PRIMARY KEY,
  safe_passes   INTEGER NOT NULL DEFAULT 0,       -- slowed appropriately, no jolt
  rough_passes  INTEGER NOT NULL DEFAULT 0,       -- jolted or did not slow
  last_pass_ms  INTEGER NOT NULL
);

-- Local alert history (never uploaded): cooldowns, tuning, rider's own review
CREATE TABLE IF NOT EXISTS alert_log (
  id            INTEGER PRIMARY KEY,
  hazard_id     TEXT NOT NULL,
  level         TEXT NOT NULL,
  distance_m    REAL NOT NULL,
  speed_kmh     REAL NOT NULL,
  slowed        INTEGER,                          -- filled after the pass
  at_ms         INTEGER NOT NULL
);

-- -----------------------------------------------------------------------------
-- Hot-path query (run at 1 Hz by the alert loop). Parameters:
--   :lat, :lon       current fix
--   :dlat, :dlon     lookahead radius converted to degrees
--                    dlat = r / 111320 ; dlon = r / (111320 * cos(lat))
--   :now_ms
-- -----------------------------------------------------------------------------
-- SELECT h.* FROM hazards_rtree r JOIN hazards h ON h.rid = r.rid
--  WHERE r.min_lat <= :lat + :dlat AND r.max_lat >= :lat - :dlat
--    AND r.min_lon <= :lon + :dlon AND r.max_lon >= :lon - :dlon
--    AND (h.expires_at_ms IS NULL OR h.expires_at_ms > :now_ms);

-- Tombstone handling during sync (server row with tombstone = true):
--   DELETE FROM hazards WHERE id = :id;
-- Upsert during sync:
--   INSERT INTO hazards (...) VALUES (...)
--   ON CONFLICT(id) DO UPDATE SET ... , sync_version = excluded.sync_version
--   WHERE excluded.sync_version > hazards.sync_version;

-- Eviction: keep pinned tiles + tiles touched in the last 30 days
--   DELETE FROM hazards WHERE tile_gh5 IN
--     (SELECT gh5 FROM tiles WHERE pinned = 0 AND fetched_at_ms < :now_ms - 30*86400000);
