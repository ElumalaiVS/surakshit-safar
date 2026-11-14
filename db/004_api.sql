-- =============================================================================
--  004_api.sql : server side of the phone <-> server contract (README_ANDROID.md)
--
--  POST /v1/outbox  -> SELECT safar.fn_apply_outbox_item(id, kind, payload, user_id) per item
--  POST /v1/sync    -> SELECT safar.fn_sync_page(tiles_json, limit)
--
--  The HTTP layer only authenticates, resolves the user, and loops; all rules live here
--  so they are transactional and tested in SQL.
-- =============================================================================
SET search_path = safar, public;

-- Every outbox item id is processed exactly once, whatever its kind. Phones replay
-- unacknowledged items after network loss; this table makes those replays harmless.
CREATE TABLE outbox_receipts (
  item_id      uuid PRIMARY KEY,
  kind         text NOT NULL,
  user_id      uuid REFERENCES app_users(id),
  outcome      text NOT NULL CHECK (outcome IN ('acked','rejected')),
  detail       text,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- Returns 'acked' or 'rejected'. Rejected = permanent problem (bad type, out of range,
-- not allowed); the phone drops it instead of retrying forever. Transient failures
-- (DB down) surface as HTTP 5xx from the API and the phone retries with backoff.
CREATE FUNCTION fn_apply_outbox_item(p_id uuid, p_kind text, p_payload jsonb, p_user uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_prev text;
  v_detail text;
BEGIN
  SELECT outcome INTO v_prev FROM safar.outbox_receipts WHERE item_id = p_id;
  IF FOUND THEN RETURN v_prev; END IF;

  BEGIN   -- sub-transaction: a rejected item leaves no partial effects
    CASE p_kind
      WHEN 'report' THEN
        IF p_user IS NULL THEN RAISE EXCEPTION 'reports require a signed-in user'; END IF;
        PERFORM safar.fn_submit_report(
          p_id, p_user, p_payload->>'hazard_type',
          (p_payload->>'lat')::double precision, (p_payload->>'lon')::double precision,
          (p_payload->>'heading_deg')::integer, (p_payload->>'speed_kmh')::numeric,
          coalesce((p_payload->>'accuracy_m')::numeric, 10), p_payload->>'photo_url',
          p_payload->>'note', coalesce((p_payload->>'reported_at')::timestamptz, now()));

      WHEN 'vote' THEN
        IF p_user IS NULL THEN RAISE EXCEPTION 'votes require a signed-in user'; END IF;
        PERFORM safar.fn_cast_vote((p_payload->>'hazard_id')::uuid, p_user,
          (p_payload->>'vote')::safar.vote_kind,
          (p_payload->>'lat')::double precision, (p_payload->>'lon')::double precision);

      WHEN 'pass' THEN
        PERFORM safar.fn_record_pass((p_payload->>'hazard_id')::uuid, (p_payload->>'jolted')::boolean);

      WHEN 'telemetry' THEN
        INSERT INTO safar.telemetry_events
              (device_pseudonym, kind, location, heading_deg, speed_kmh, peak_g, duration_ms,
               vehicle_class, recorded_at)
        VALUES (decode(p_payload->>'device_pseudonym', 'hex'),
                (p_payload->>'kind')::safar.telemetry_kind,
                safar.fn_point((p_payload->>'lat')::double precision, (p_payload->>'lon')::double precision),
                (p_payload->>'heading_deg')::smallint,
                (p_payload->>'speed_kmh')::numeric,
                (p_payload->>'peak_g')::numeric,
                (p_payload->>'duration_ms')::integer,
                p_payload->>'vehicle_class',
                (p_payload->>'recorded_at')::timestamptz);

      ELSE
        RAISE EXCEPTION 'unknown outbox kind %', p_kind;
    END CASE;
  EXCEPTION
    WHEN raise_exception OR data_exception OR integrity_constraint_violation
         OR invalid_text_representation OR undefined_object THEN
      GET STACKED DIAGNOSTICS v_detail = MESSAGE_TEXT;
      INSERT INTO safar.outbox_receipts (item_id, kind, user_id, outcome, detail)
      VALUES (p_id, p_kind, p_user, 'rejected', v_detail);
      RETURN 'rejected';
  END;

  INSERT INTO safar.outbox_receipts (item_id, kind, user_id, outcome) VALUES (p_id, p_kind, p_user, 'acked');
  RETURN 'acked';
END $$;

-- One sync page for many tiles, each with its own "since" version.
--   p_tiles: [{"gh5":"tf2mr","since":0}, ...]
-- Rows are ordered by sync_version and cut at p_limit; because the cut is on the global
-- version order, a client that advances each tile to the max version it received never
-- misses a row. First sync of a tile (since = 0) skips tombstones: nothing to delete yet.
CREATE FUNCTION fn_sync_page(p_tiles jsonb, p_limit integer DEFAULT 5000)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH req AS (
    SELECT t->>'gh5' AS gh5, coalesce((t->>'since')::bigint, 0) AS since
      FROM jsonb_array_elements(p_tiles) t
  ),
  hits AS (
    SELECT h.id                                  AS hazard_id,
           h.hazard_type,
           ST_Y(h.location::geometry)            AS lat,
           ST_X(h.location::geometry)            AS lon,
           ST_AsGeoJSON(h.extent)                AS extent_geojson,
           h.bearing_deg,
           h.severity,
           h.status,
           h.trust_tier,
           h.confidence,
           h.expires_at,
           h.tile_gh5,
           h.sync_version,
           NOT (h.status IN ('candidate','community_verified','authority_verified',
                             'work_scheduled','resolved_pending_check') AND ht.rider_alert) AS tombstone,
           req.since
      FROM req
      JOIN safar.road_hazards h  ON h.tile_gh5 = req.gh5 AND h.sync_version > req.since
      JOIN safar.hazard_types ht ON ht.code = h.hazard_type
  ),
  page AS (
    SELECT * FROM hits
     WHERE NOT (tombstone AND since = 0)
     ORDER BY sync_version
     LIMIT p_limit + 1
  ),
  numbered AS (
    SELECT p.*, row_number() OVER (ORDER BY sync_version) AS rn FROM page p
  )
  SELECT jsonb_build_object(
           'rows', coalesce(jsonb_agg(to_jsonb(n) - 'rn' - 'since' ORDER BY n.sync_version)
                              FILTER (WHERE n.rn <= p_limit), '[]'::jsonb),
           'has_more', count(*) > p_limit)
    FROM numbered n
$$;
