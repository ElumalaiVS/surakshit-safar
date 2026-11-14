-- =============================================================================
--  Surakshit Safar — Survival-first road hazard platform
--  001_schema.sql : core PostGIS schema
--
--  Target: PostgreSQL 15+ / PostGIS 3.3+
--  Conventions
--    * All rider-facing coordinates are GEOGRAPHY(…, 4326) so distances are
--      metres on the WGS-84 spheroid without per-state UTM juggling.
--    * Heavy clustering / buffering uses EPSG:7755 (WGS 84 / India NSF LCC),
--      a single metric projection that covers the whole country.
--    * Every rider-visible row carries a monotonically increasing
--      sync_version so phones can pull deltas for offline caches.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- gen_random_uuid(), digest()

CREATE SCHEMA IF NOT EXISTS safar;
SET search_path = safar, public;

-- -----------------------------------------------------------------------------
-- 1. Enumerations
-- -----------------------------------------------------------------------------
CREATE TYPE agency_type AS ENUM (
  'gram_panchayat', 'mandal_parishad', 'municipality', 'district_admin',
  'state_pwd', 'pmgsy', 'nhai', 'morth_ro', 'traffic_police', 'state_road_safety_council'
);

CREATE TYPE road_class AS ENUM (
  'national_highway', 'state_highway', 'major_district_road',
  'other_district_road', 'village_road', 'urban_arterial', 'urban_local'
);

CREATE TYPE user_role AS ENUM (
  'rider',              -- ordinary citizen / commuter
  'gig_rider',          -- verified delivery / ride-hailing partner (fleet-linked)
  'trusted_reporter',   -- panchayat secretary, ASHA, teacher, NGO volunteer
  'authority_officer',  -- officer of an agency; can act only inside its geofence
  'moderator',          -- platform staff
  'admin'
);

CREATE TYPE hazard_category AS ENUM (
  'infrastructure_geometry', 'traffic_calming_conflict', 'dynamic_environmental'
);

CREATE TYPE severity_level AS ENUM ('info', 'warning', 'critical');

CREATE TYPE persistence_kind AS ENUM (
  'permanent',   -- geometry: bends, junctions, humps        (no expiry)
  'semi',        -- surface defects: potholes                (expire unless re-seen, weeks)
  'transient',   -- spills, parked trucks, waterlogging      (expire in hours)
  'recurring'    -- patterned: cattle at dusk, school hours  (permanent pin, time-gated alert)
);

CREATE TYPE active_condition AS ENUM (
  'always', 'night', 'dusk_dawn', 'school_hours', 'rain', 'monsoon_season'
);

-- Trust tier = strongest evidence that has touched this hazard.
--   1 = authority verified, 2 = community consensus, 3 = passive telemetry only
CREATE DOMAIN trust_tier AS smallint CHECK (VALUE IN (1, 2, 3));

CREATE TYPE hazard_status AS ENUM (
  'candidate',               -- single report or telemetry cluster, not yet trusted
  'community_verified',      -- peer consensus reached (Tier 2)
  'authority_verified',      -- confirmed by owning agency (Tier 1)
  'work_scheduled',          -- agency committed a fix date
  'resolved_pending_check',  -- agency says fixed; waiting for riders/telemetry to agree
  'closed',                  -- fix confirmed independently
  'dismissed',               -- false / duplicate / out of scope
  'expired'                  -- transient hazard aged out without reconfirmation
);

CREATE TYPE vote_kind AS ENUM ('confirm', 'deny', 'fixed');

CREATE TYPE telemetry_kind AS ENUM (
  'vertical_jolt_pothole',   -- sharp downward-then-up impulse
  'vertical_jolt_hump',      -- longer symmetric lift: speed breaker
  'hard_brake',              -- decel > ~0.4 g
  'swerve'                   -- yaw-rate spike: evasive manoeuvre
);

CREATE TYPE audit_action AS ENUM (
  'created', 'report_attached', 'vote', 'promoted', 'verified', 'rejected',
  'assigned', 'work_scheduled', 'resolved', 'closed', 'reopened',
  'escalated', 'expired', 'dismissed', 'edited'
);

CREATE TYPE ticket_status AS ENUM ('open', 'acknowledged', 'in_progress', 'resolved', 'closed');

-- -----------------------------------------------------------------------------
-- 2. Governance: agencies and their geofences
-- -----------------------------------------------------------------------------
CREATE TABLE agencies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  agency_type       agency_type NOT NULL,
  lgd_code          text UNIQUE,                       -- Local Government Directory code
  parent_agency_id  uuid REFERENCES agencies(id),      -- escalation ladder
  state_code        char(2) NOT NULL,
  district          text,
  boundary          geography(MultiPolygon, 4326) NOT NULL,
  contact_phone     text,
  contact_email     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agencies_boundary_gix ON agencies USING gist (boundary);
CREATE INDEX agencies_parent_idx   ON agencies (parent_agency_id);

-- Road network (import from OSM + PMGSY OMMAS + NHAI chainage)
CREATE TABLE road_segments (
  id               bigserial PRIMARY KEY,
  osm_way_id       bigint,
  name             text,
  road_class       road_class NOT NULL,
  ref              text,                               -- e.g. 'NH16', 'SH31'
  owner_agency_id  uuid REFERENCES agencies(id),       -- who must fix it
  geom             geography(LineString, 4326) NOT NULL,
  speed_limit_kmh  smallint,
  is_lit           boolean,
  has_median       boolean,
  lanes            smallint,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX road_segments_geom_gix  ON road_segments USING gist (geom);
CREATE INDEX road_segments_owner_idx ON road_segments (owner_agency_id);

-- -----------------------------------------------------------------------------
-- 3. Users and reputation
-- -----------------------------------------------------------------------------
CREATE TABLE app_users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role                user_role NOT NULL DEFAULT 'rider',
  agency_id           uuid REFERENCES agencies(id),
  phone_hash          bytea UNIQUE,                    -- sha256(phone || pepper); never raw
  device_attested     boolean NOT NULL DEFAULT false,  -- Play Integrity / App Attest passed
  reputation          numeric(5,3) NOT NULL DEFAULT 1.000 CHECK (reputation BETWEEN 0 AND 5),
  preferred_language  text NOT NULL DEFAULT 'te',      -- BCP-47: te, hi, ta, kn, en ...
  is_banned           boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT officer_needs_agency CHECK (role <> 'authority_officer' OR agency_id IS NOT NULL)
);

-- -----------------------------------------------------------------------------
-- 4. Hazard taxonomy (data, not code: new types ship without an app release)
-- -----------------------------------------------------------------------------
CREATE TABLE hazard_types (
  code               text PRIMARY KEY,
  category           hazard_category NOT NULL,
  label_en           text NOT NULL,
  default_severity   severity_level NOT NULL,
  persistence        persistence_kind NOT NULL,
  ttl_hours          integer,                -- NULL = never auto-expires
  dedupe_radius_m    integer NOT NULL,       -- reports closer than this merge
  directional        boolean NOT NULL DEFAULT false,  -- relevant only for one travel bearing
  active_when        active_condition NOT NULL DEFAULT 'always',
  rider_alert        boolean NOT NULL DEFAULT true,   -- false = governance-only (e.g. missing sign)
  two_wheeler_boost  boolean NOT NULL DEFAULT false,  -- escalate severity for 2W/3W riders
  is_stretch         boolean NOT NULL DEFAULT false,  -- uses extent linestring, not a point
  CHECK (persistence <> 'transient' OR ttl_hours IS NOT NULL)
);

CREATE TABLE hazard_type_labels (            -- regional-language labels and voice prompt keys
  code          text REFERENCES hazard_types(code) ON DELETE CASCADE,
  lang          text,
  label         text NOT NULL,
  voice_clip    text,                        -- asset key of pre-recorded human voice prompt
  PRIMARY KEY (code, lang)
);

-- -----------------------------------------------------------------------------
-- 5. Hazards: the canonical, de-duplicated record riders are alerted about
-- -----------------------------------------------------------------------------
CREATE SEQUENCE hazard_sync_seq;

CREATE TABLE road_hazards (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hazard_type        text NOT NULL REFERENCES hazard_types(code),
  location           geography(Point, 4326) NOT NULL,
  extent             geography(LineString, 4326),            -- for stretches (dark zone, pothole belt)
  bearing_deg        smallint CHECK (bearing_deg BETWEEN 0 AND 359), -- travel direction it applies to
  severity           severity_level NOT NULL,
  status             hazard_status NOT NULL DEFAULT 'candidate',
  trust_tier         trust_tier NOT NULL,
  confidence         numeric(4,3) NOT NULL DEFAULT 0.300 CHECK (confidence BETWEEN 0 AND 1),
  confirm_count      integer NOT NULL DEFAULT 0,
  deny_count         integer NOT NULL DEFAULT 0,
  telemetry_hits     integer NOT NULL DEFAULT 0,
  -- physics-based closure check: anonymous "I just drove over it" pass reports
  smooth_passes_since_resolve integer NOT NULL DEFAULT 0,
  jolt_passes_since_resolve   integer NOT NULL DEFAULT 0,
  owner_agency_id    uuid REFERENCES agencies(id),
  road_segment_id    bigint REFERENCES road_segments(id),
  description        text,
  photo_urls         text[] NOT NULL DEFAULT '{}',
  first_reported_at  timestamptz NOT NULL DEFAULT now(),
  last_confirmed_at  timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz,
  resolved_at        timestamptz,
  closed_at          timestamptz,
  sync_version       bigint NOT NULL DEFAULT nextval('hazard_sync_seq'),
  -- geohash-5 tile (~4.9 km x 4.9 km) used for offline bounding-box prefetch
  tile_gh5           text GENERATED ALWAYS AS (ST_GeoHash(location::geometry, 5)) STORED,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Spatial index: radius + KNN lookups
CREATE INDEX road_hazards_location_gix ON road_hazards USING gist (location);
-- Partial spatial index for the hot path: only what riders can be alerted about
CREATE INDEX road_hazards_live_gix ON road_hazards USING gist (location)
  WHERE status IN ('community_verified','authority_verified','work_scheduled','resolved_pending_check','candidate');
CREATE INDEX road_hazards_extent_gix ON road_hazards USING gist (extent) WHERE extent IS NOT NULL;
-- Offline sync: "give me everything in these tiles changed since version N"
CREATE INDEX road_hazards_tile_sync_idx ON road_hazards (tile_gh5, sync_version);
CREATE INDEX road_hazards_owner_status_idx ON road_hazards (owner_agency_id, status);
CREATE INDEX road_hazards_expiry_idx ON road_hazards (expires_at) WHERE expires_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 6. Tier 2 raw input: community reports and votes
-- -----------------------------------------------------------------------------
CREATE TABLE hazard_reports (
  id               uuid PRIMARY KEY,               -- client-generated: idempotent offline replay
  user_id          uuid NOT NULL REFERENCES app_users(id),
  hazard_type      text NOT NULL REFERENCES hazard_types(code),
  location         geography(Point, 4326) NOT NULL,
  heading_deg      smallint,
  speed_kmh        numeric(5,1),
  gps_accuracy_m   numeric(6,1),
  photo_url        text,
  note             text,
  reported_at      timestamptz NOT NULL,           -- device clock (may be hours old if offline)
  received_at      timestamptz NOT NULL DEFAULT now(),
  hazard_id        uuid REFERENCES road_hazards(id),
  rejected_reason  text
);
CREATE INDEX hazard_reports_location_gix ON hazard_reports USING gist (location);
CREATE INDEX hazard_reports_user_time_idx ON hazard_reports (user_id, received_at DESC);

CREATE TABLE hazard_votes (
  hazard_id      uuid NOT NULL REFERENCES road_hazards(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES app_users(id),
  vote           vote_kind NOT NULL,
  weight         numeric(5,3) NOT NULL,
  voter_location geography(Point, 4326) NOT NULL,   -- proof of presence
  voted_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hazard_id, user_id)                  -- one live vote per person per hazard
);

-- -----------------------------------------------------------------------------
-- 7. Tier 3 raw input: passive telemetry events (anonymous)
-- -----------------------------------------------------------------------------
CREATE TABLE telemetry_events (
  id               bigserial PRIMARY KEY,
  device_pseudonym bytea NOT NULL,                 -- rotating weekly hash; not linkable to user
  kind             telemetry_kind NOT NULL,
  location         geography(Point, 4326) NOT NULL,
  heading_deg      smallint,
  speed_kmh        numeric(5,1) NOT NULL,
  peak_g           numeric(5,3) NOT NULL,          -- speed-normalised impulse magnitude
  duration_ms      integer NOT NULL,
  vehicle_class    text,                           -- '2w','3w','car','bus'
  recorded_at      timestamptz NOT NULL,
  clustered_into   uuid REFERENCES road_hazards(id),
  processed        boolean NOT NULL DEFAULT false
);
CREATE INDEX telemetry_unprocessed_gix ON telemetry_events USING gist (location) WHERE NOT processed;
CREATE INDEX telemetry_time_brin ON telemetry_events USING brin (recorded_at);

-- -----------------------------------------------------------------------------
-- 8. Accountability: tickets, SLA policies, tamper-evident audit log
-- -----------------------------------------------------------------------------
CREATE TABLE sla_policies (
  severity            severity_level PRIMARY KEY,
  acknowledge_hours   integer NOT NULL,
  resolve_hours       integer NOT NULL,
  escalate_after_hours integer NOT NULL     -- each overdue step climbs one level
);

CREATE TABLE tickets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hazard_id           uuid NOT NULL UNIQUE REFERENCES road_hazards(id) ON DELETE CASCADE,
  assigned_agency_id  uuid NOT NULL REFERENCES agencies(id),
  original_agency_id  uuid NOT NULL REFERENCES agencies(id),
  status              ticket_status NOT NULL DEFAULT 'open',
  escalation_level    smallint NOT NULL DEFAULT 0,
  acknowledge_due_at  timestamptz NOT NULL,
  resolve_due_at      timestamptz NOT NULL,
  next_escalation_at  timestamptz NOT NULL,
  acknowledged_at     timestamptz,
  scheduled_fix_date  date,
  resolved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tickets_agency_status_idx ON tickets (assigned_agency_id, status);
CREATE INDEX tickets_escalation_idx ON tickets (next_escalation_at) WHERE status IN ('open','acknowledged','in_progress');

-- Append-only, hash-chained per hazard: any edit to history breaks the chain.
CREATE TABLE hazard_events (
  id              bigserial PRIMARY KEY,
  hazard_id       uuid NOT NULL REFERENCES road_hazards(id) ON DELETE CASCADE,
  action          audit_action NOT NULL,
  actor_user_id   uuid REFERENCES app_users(id),
  actor_agency_id uuid REFERENCES agencies(id),
  from_status     hazard_status,
  to_status       hazard_status,
  actor_location  geography(Point, 4326),
  evidence_url    text,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  prev_hash       bytea,
  row_hash        bytea NOT NULL
);
CREATE INDEX hazard_events_hazard_idx ON hazard_events (hazard_id, id);

-- -----------------------------------------------------------------------------
-- 9. Triggers
-- -----------------------------------------------------------------------------

-- 9a. Bump sync_version and updated_at on every change so phones see the delta
CREATE FUNCTION trg_hazard_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.sync_version := nextval('safar.hazard_sync_seq');
  NEW.updated_at   := now();
  RETURN NEW;
END $$;
CREATE TRIGGER road_hazards_touch BEFORE UPDATE ON road_hazards
  FOR EACH ROW EXECUTE FUNCTION trg_hazard_touch();

-- 9b. Hash chain for the audit log
CREATE FUNCTION trg_event_hash() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_prev bytea;
BEGIN
  -- serialise per hazard so two concurrent events cannot fork the chain
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.hazard_id::text, 0));
  SELECT row_hash INTO v_prev FROM safar.hazard_events
   WHERE hazard_id = NEW.hazard_id ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := v_prev;
  NEW.row_hash  := digest(
      coalesce(encode(v_prev,'hex'),'GENESIS') || '|' ||
      NEW.hazard_id::text || '|' || NEW.action::text || '|' ||
      coalesce(NEW.actor_user_id::text,'') || '|' ||
      coalesce(NEW.from_status::text,'') || '>' || coalesce(NEW.to_status::text,'') || '|' ||
      coalesce(ST_AsText(NEW.actor_location),'') || '|' ||
      coalesce(NEW.note,'') || '|' || NEW.created_at::text,
      'sha256');
  RETURN NEW;
END $$;
CREATE TRIGGER hazard_events_hash BEFORE INSERT ON hazard_events
  FOR EACH ROW EXECUTE FUNCTION trg_event_hash();

CREATE FUNCTION trg_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'hazard_events is append-only';
END $$;
CREATE TRIGGER hazard_events_no_update BEFORE UPDATE OR DELETE ON hazard_events
  FOR EACH ROW EXECUTE FUNCTION trg_event_immutable();

-- -----------------------------------------------------------------------------
-- 10. Public accountability view (feeds the dashboard and weekly gram-sabha PDF)
-- -----------------------------------------------------------------------------
CREATE VIEW v_agency_scorecard AS
SELECT a.id                                   AS agency_id,
       a.name,
       a.agency_type,
       count(*) FILTER (WHERE t.status IN ('open','acknowledged','in_progress'))           AS open_tickets,
       count(*) FILTER (WHERE t.status IN ('open','acknowledged','in_progress')
                          AND t.resolve_due_at < now())                                   AS overdue_tickets,
       count(*) FILTER (WHERE h.severity = 'critical'
                          AND t.status IN ('open','acknowledged','in_progress'))           AS open_critical,
       round(extract(epoch FROM percentile_cont(0.5) WITHIN GROUP
             (ORDER BY (t.resolved_at - t.created_at))) / 3600.0, 1)                      AS median_hours_to_resolve,
       count(*) FILTER (WHERE t.escalation_level > 0)                                      AS ever_escalated
  FROM agencies a
  LEFT JOIN tickets t      ON t.original_agency_id = a.id
  LEFT JOIN road_hazards h ON h.id = t.hazard_id
 GROUP BY a.id, a.name, a.agency_type;
