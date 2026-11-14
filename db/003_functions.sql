-- =============================================================================
--  003_functions.sql : trust model, governance workflow, spatial queries, sync
-- =============================================================================
SET search_path = safar, public;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_point(p_lat double precision, p_lon double precision)
RETURNS geography LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography
$$;

CREATE FUNCTION fn_bearing_diff(a integer, b integer)
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN a IS NULL OR b IS NULL THEN 0
              ELSE least(abs(a - b) % 360, 360 - abs(a - b) % 360) END
$$;

-- Vote weight = role weight x reputation x device-attestation factor
CREATE FUNCTION fn_user_weight(p_user uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT (CASE u.role
            WHEN 'authority_officer' THEN 3.0
            WHEN 'trusted_reporter'  THEN 2.0
            WHEN 'gig_rider'         THEN 1.2
            ELSE 1.0 END)
         * u.reputation
         * (CASE WHEN u.device_attested THEN 1.0 ELSE 0.5 END)
    FROM safar.app_users u WHERE u.id = p_user
$$;

-- Who owns the road at this point? Nearest segment's owner, else the smallest
-- agency geofence covering the point (usually the gram panchayat).
CREATE FUNCTION fn_resolve_owner(p_loc geography,
                                 OUT agency_id uuid, OUT segment_id bigint)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  SELECT rs.owner_agency_id, rs.id INTO agency_id, segment_id
    FROM safar.road_segments rs
   WHERE ST_DWithin(rs.geom, p_loc, 30)
   ORDER BY rs.geom <-> p_loc
   LIMIT 1;

  IF agency_id IS NULL THEN
    SELECT a.id INTO agency_id
      FROM safar.agencies a
     WHERE ST_Covers(a.boundary, p_loc)
     ORDER BY ST_Area(a.boundary) ASC
     LIMIT 1;
  END IF;
END $$;

CREATE FUNCTION fn_log(p_hazard uuid, p_action audit_action, p_actor uuid,
                       p_from hazard_status, p_to hazard_status,
                       p_loc geography DEFAULT NULL, p_note text DEFAULT NULL,
                       p_evidence text DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO safar.hazard_events
         (hazard_id, action, actor_user_id, actor_agency_id, from_status, to_status,
          actor_location, note, evidence_url, row_hash)
  SELECT p_hazard, p_action, p_actor,
         (SELECT agency_id FROM safar.app_users WHERE id = p_actor),
         p_from, p_to, p_loc, p_note, p_evidence, '\x00'::bytea   -- real hash set by trigger
$$;

-- -----------------------------------------------------------------------------
-- Tickets: opened when a hazard becomes trusted (Tier 2 consensus or Tier 1)
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_open_ticket(p_hazard uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  h  safar.road_hazards%ROWTYPE;
  sp safar.sla_policies%ROWTYPE;
  t_id uuid;
BEGIN
  SELECT * INTO h FROM safar.road_hazards WHERE id = p_hazard;
  IF h.owner_agency_id IS NULL THEN
    RETURN NULL;   -- unmapped location: surfaces on the moderator queue instead
  END IF;
  SELECT * INTO sp FROM safar.sla_policies WHERE severity = h.severity;

  INSERT INTO safar.tickets (hazard_id, assigned_agency_id, original_agency_id,
                             acknowledge_due_at, resolve_due_at, next_escalation_at)
  VALUES (h.id, h.owner_agency_id, h.owner_agency_id,
          now() + make_interval(hours => sp.acknowledge_hours),
          now() + make_interval(hours => sp.resolve_hours),
          now() + make_interval(hours => sp.resolve_hours))
  ON CONFLICT (hazard_id) DO NOTHING
  RETURNING id INTO t_id;

  IF t_id IS NOT NULL THEN
    PERFORM safar.fn_log(h.id, 'assigned', NULL, h.status, h.status, NULL,
                         'Ticket routed to owning agency');
  END IF;
  RETURN t_id;
END $$;

-- -----------------------------------------------------------------------------
-- Confidence model (Tier 2 + Tier 3 evidence, time-decayed)
--
--   evidence(v) = weight(v) * exp(-age_days / tau)
--   tau: transient 0.5 d, semi 30 d, permanent/recurring 365 d
--   net = sum(confirm) + 0.35 * telemetry_devices - sum(deny)
--   confidence = 1 - exp(-max(net,0) / 1.5)         (2 attested riders ~0.74)
--   Tier 1 hazards keep a 0.95 floor unless the agency itself closes them.
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_recompute(p_hazard uuid)
RETURNS hazard_status LANGUAGE plpgsql AS $$
DECLARE
  h        safar.road_hazards%ROWTYPE;
  ht       safar.hazard_types%ROWTYPE;
  tau      numeric;
  s_conf   numeric; s_deny numeric;
  n_conf   int;     n_deny int;
  n_fixed  int;     n_reconfirm int;
  net      numeric;
  conf     numeric;
  new_status hazard_status;
BEGIN
  SELECT * INTO h  FROM safar.road_hazards WHERE id = p_hazard FOR UPDATE;
  SELECT * INTO ht FROM safar.hazard_types WHERE code = h.hazard_type;

  tau := CASE ht.persistence WHEN 'transient' THEN 0.5 WHEN 'semi' THEN 30 ELSE 365 END;

  SELECT coalesce(sum(weight * exp(-extract(epoch FROM now() - voted_at) / 86400.0 / tau))
                  FILTER (WHERE vote = 'confirm'), 0),
         coalesce(sum(weight * exp(-extract(epoch FROM now() - voted_at) / 86400.0 / tau))
                  FILTER (WHERE vote = 'deny'), 0),
         count(*) FILTER (WHERE vote = 'confirm'),
         count(*) FILTER (WHERE vote = 'deny'),
         count(*) FILTER (WHERE vote = 'fixed'   AND h.resolved_at IS NOT NULL AND voted_at > h.resolved_at),
         count(*) FILTER (WHERE vote = 'confirm' AND h.resolved_at IS NOT NULL AND voted_at > h.resolved_at)
    INTO s_conf, s_deny, n_conf, n_deny, n_fixed, n_reconfirm
    FROM safar.hazard_votes WHERE hazard_id = p_hazard;

  net  := s_conf + 0.35 * h.telemetry_hits - s_deny;
  conf := 1 - exp(-greatest(net, 0) / 1.5);
  IF h.trust_tier = 1 THEN conf := greatest(conf, 0.95); END IF;
  conf := least(conf, 0.999);

  new_status := h.status;

  -- Promotion / demotion by community evidence
  IF h.status = 'candidate' AND conf >= 0.70 AND (n_conf >= 2 OR h.telemetry_hits >= 6) THEN
    new_status := 'community_verified';
  ELSIF h.status = 'candidate' AND n_deny >= 3 AND s_deny >= 1.5 * s_conf THEN
    new_status := 'dismissed';
  ELSIF h.status = 'community_verified' AND n_deny >= 3 AND s_deny >= 1.5 * s_conf THEN
    new_status := 'candidate';
  END IF;

  -- Closure check: agency said "fixed"; do riders and physics agree?
  IF h.status = 'resolved_pending_check' THEN
    IF n_reconfirm >= 2
       OR (h.jolt_passes_since_resolve >= 5
           AND h.jolt_passes_since_resolve::numeric
               / nullif(h.jolt_passes_since_resolve + h.smooth_passes_since_resolve, 0) >= 0.40) THEN
      new_status := 'authority_verified';                        -- reopened: fake/failed fix
    ELSIF n_fixed >= 2
       OR (h.smooth_passes_since_resolve >= 20
           AND h.jolt_passes_since_resolve::numeric
               / nullif(h.jolt_passes_since_resolve + h.smooth_passes_since_resolve, 0) < 0.10) THEN
      new_status := 'closed';
    END IF;
  END IF;

  UPDATE safar.road_hazards
     SET confidence    = round(conf, 3),
         confirm_count = n_conf,
         deny_count    = n_deny,
         status        = new_status,
         trust_tier    = CASE WHEN new_status = 'community_verified'
                              THEN least(trust_tier, 2)::smallint ELSE trust_tier END,
         closed_at     = CASE WHEN new_status = 'closed' THEN now() ELSE closed_at END,
         resolved_at   = CASE WHEN new_status = 'authority_verified'
                               AND h.status = 'resolved_pending_check' THEN NULL ELSE resolved_at END
   WHERE id = p_hazard;

  IF new_status <> h.status THEN
    PERFORM safar.fn_log(p_hazard,
      CASE new_status
        WHEN 'community_verified' THEN 'promoted'
        WHEN 'dismissed'          THEN 'dismissed'
        WHEN 'closed'             THEN 'closed'
        WHEN 'authority_verified' THEN 'reopened'
        ELSE 'edited' END::safar.audit_action,
      NULL, h.status, new_status, NULL, 'automatic: consensus / telemetry rule');

    IF new_status = 'community_verified' THEN
      PERFORM safar.fn_open_ticket(p_hazard);
    ELSIF new_status = 'closed' THEN
      UPDATE safar.tickets SET status = 'closed' WHERE hazard_id = p_hazard;
    ELSIF new_status = 'authority_verified' AND h.status = 'resolved_pending_check' THEN
      -- failed fix: ticket goes back to work and the strike stays on the record
      UPDATE safar.tickets SET status = 'in_progress', resolved_at = NULL,
                               next_escalation_at = now()
       WHERE hazard_id = p_hazard;
      UPDATE safar.road_hazards
         SET smooth_passes_since_resolve = 0, jolt_passes_since_resolve = 0
       WHERE id = p_hazard;
    END IF;
  END IF;

  RETURN new_status;
END $$;

-- -----------------------------------------------------------------------------
-- Tier 2: votes (proof-of-presence required)
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_cast_vote(p_hazard uuid, p_user uuid, p_vote vote_kind,
                             p_lat double precision, p_lon double precision)
RETURNS hazard_status LANGUAGE plpgsql AS $$
DECLARE
  v_loc geography := safar.fn_point(p_lat, p_lon);
  h     safar.road_hazards%ROWTYPE;
  v_w   numeric;
BEGIN
  SELECT * INTO h FROM safar.road_hazards WHERE id = p_hazard;
  IF NOT FOUND THEN RAISE EXCEPTION 'hazard % not found', p_hazard; END IF;
  IF (SELECT is_banned FROM safar.app_users WHERE id = p_user) THEN
    RAISE EXCEPTION 'user is banned';
  END IF;
  -- You can only vote on what you can see: within 150 m of the pin or stretch
  IF NOT ST_DWithin(coalesce(h.extent, h.location), v_loc, 150) THEN
    RAISE EXCEPTION 'vote rejected: voter is % m away (must be within 150 m)',
      round(ST_Distance(coalesce(h.extent, h.location), v_loc)::numeric);
  END IF;

  v_w := safar.fn_user_weight(p_user);

  INSERT INTO safar.hazard_votes (hazard_id, user_id, vote, weight, voter_location, voted_at)
  VALUES (p_hazard, p_user, p_vote, v_w, v_loc, now())
  ON CONFLICT (hazard_id, user_id)
  DO UPDATE SET vote = EXCLUDED.vote, weight = EXCLUDED.weight,
                voter_location = EXCLUDED.voter_location, voted_at = now();

  IF p_vote = 'confirm' THEN
    UPDATE safar.road_hazards
       SET last_confirmed_at = now(),
           expires_at = CASE WHEN expires_at IS NULL THEN NULL
                             ELSE now() + make_interval(hours =>
                                  (SELECT ttl_hours FROM safar.hazard_types WHERE code = h.hazard_type))
                        END
     WHERE id = p_hazard;
  END IF;

  PERFORM safar.fn_log(p_hazard, 'vote', p_user, h.status, h.status, v_loc, p_vote::text);
  RETURN safar.fn_recompute(p_hazard);
END $$;

-- -----------------------------------------------------------------------------
-- Tier 2 (and Tier 1 official pins): submit a report. Idempotent on report id.
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_submit_report(
  p_report_id uuid, p_user uuid, p_type text,
  p_lat double precision, p_lon double precision,
  p_heading integer DEFAULT NULL, p_speed_kmh numeric DEFAULT NULL,
  p_accuracy_m numeric DEFAULT 10, p_photo text DEFAULT NULL,
  p_note text DEFAULT NULL, p_reported_at timestamptz DEFAULT now(),
  p_extent_wkt text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_loc   geography := safar.fn_point(p_lat, p_lon);
  u       safar.app_users%ROWTYPE;
  ht      safar.hazard_types%ROWTYPE;
  v_hid   uuid;
  v_owner uuid; v_seg bigint;
  v_is_official boolean := false;
  v_recent int;
BEGIN
  -- Idempotent replay from offline outbox
  SELECT hazard_id INTO v_hid FROM safar.hazard_reports WHERE id = p_report_id;
  IF FOUND THEN RETURN v_hid; END IF;

  SELECT * INTO u  FROM safar.app_users   WHERE id = p_user;
  SELECT * INTO ht FROM safar.hazard_types WHERE code = p_type;
  IF u.id IS NULL OR u.is_banned THEN RAISE EXCEPTION 'unknown or banned user'; END IF;
  IF ht.code IS NULL THEN RAISE EXCEPTION 'unknown hazard type %', p_type; END IF;

  -- Quality gates: store the raw report either way, for audit
  SELECT count(*) INTO v_recent FROM safar.hazard_reports
   WHERE user_id = p_user AND received_at > now() - interval '1 hour';
  IF v_recent >= 30 OR p_accuracy_m > 50
     OR (ht.persistence = 'transient' AND p_reported_at < now() - make_interval(hours => ht.ttl_hours)) THEN
    INSERT INTO safar.hazard_reports (id, user_id, hazard_type, location, heading_deg, speed_kmh,
                                      gps_accuracy_m, photo_url, note, reported_at, rejected_reason)
    VALUES (p_report_id, p_user, p_type, v_loc, p_heading, p_speed_kmh, p_accuracy_m, p_photo, p_note,
            p_reported_at,
            CASE WHEN v_recent >= 30 THEN 'rate_limited'
                 WHEN p_accuracy_m > 50 THEN 'gps_inaccurate'
                 ELSE 'stale_transient' END);
    RETURN NULL;
  END IF;

  -- Official pin: an officer marking a hazard inside their own geofence
  IF u.role = 'authority_officer' THEN
    IF NOT EXISTS (SELECT 1 FROM safar.agencies a
                    WHERE a.id = u.agency_id AND ST_Covers(a.boundary, v_loc)) THEN
      RAISE EXCEPTION 'officer may only pin hazards inside their agency jurisdiction';
    END IF;
    v_is_official := true;
  END IF;

  -- De-duplicate: same type, open, within the type's merge radius, compatible bearing
  SELECT h.id INTO v_hid
    FROM safar.road_hazards h
   WHERE h.hazard_type = p_type
     AND h.status NOT IN ('closed','dismissed','expired')
     AND ST_DWithin(coalesce(h.extent, h.location), v_loc, ht.dedupe_radius_m)
     AND (NOT ht.directional OR safar.fn_bearing_diff(h.bearing_deg, p_heading) <= 45)
   ORDER BY h.location <-> v_loc
   LIMIT 1;

  IF v_hid IS NULL THEN
    SELECT agency_id, segment_id INTO v_owner, v_seg FROM safar.fn_resolve_owner(v_loc);
    INSERT INTO safar.road_hazards
          (hazard_type, location, extent, bearing_deg, severity, status, trust_tier, confidence,
           owner_agency_id, road_segment_id, description, photo_urls,
           first_reported_at, last_confirmed_at, expires_at)
    VALUES (p_type, v_loc,
            CASE WHEN p_extent_wkt IS NULL THEN NULL ELSE ST_GeogFromText('SRID=4326;' || p_extent_wkt) END,
            CASE WHEN ht.directional THEN p_heading END,
            ht.default_severity,
            (CASE WHEN v_is_official THEN 'authority_verified' ELSE 'candidate' END)::safar.hazard_status,
            (CASE WHEN v_is_official THEN 1 ELSE 2 END)::smallint,
            CASE WHEN v_is_official THEN 0.95 ELSE 0.30 END,
            CASE WHEN v_is_official THEN u.agency_id ELSE v_owner END, v_seg, p_note,
            CASE WHEN p_photo IS NULL THEN '{}' ELSE ARRAY[p_photo] END,
            p_reported_at, p_reported_at,
            CASE WHEN ht.ttl_hours IS NOT NULL
                 THEN p_reported_at + make_interval(hours => ht.ttl_hours) END)
    RETURNING id INTO v_hid;

    PERFORM safar.fn_log(v_hid, 'created', p_user, NULL,
                         CASE WHEN v_is_official THEN 'authority_verified' ELSE 'candidate' END::safar.hazard_status,
                         v_loc, p_note, p_photo);
    IF v_is_official THEN PERFORM safar.fn_open_ticket(v_hid); END IF;
  ELSE
    PERFORM safar.fn_log(v_hid, 'report_attached', p_user, NULL, NULL, v_loc, p_note, p_photo);
    IF p_photo IS NOT NULL THEN
      UPDATE safar.road_hazards SET photo_urls = array_append(photo_urls, p_photo) WHERE id = v_hid;
    END IF;
  END IF;

  INSERT INTO safar.hazard_reports (id, user_id, hazard_type, location, heading_deg, speed_kmh,
                                    gps_accuracy_m, photo_url, note, reported_at, hazard_id)
  VALUES (p_report_id, p_user, p_type, v_loc, p_heading, p_speed_kmh, p_accuracy_m, p_photo, p_note,
          p_reported_at, v_hid);

  -- A report is also a confirm vote by the reporter
  PERFORM safar.fn_cast_vote(v_hid, p_user, 'confirm', p_lat, p_lon);
  RETURN v_hid;
END $$;

-- -----------------------------------------------------------------------------
-- Tier 1: authority workflow (geofenced, site-presence enforced, audited)
--   verify   -> authority_verified (ticket acknowledged)
--   reject   -> dismissed; but rejecting a strong community hazard escalates
--   schedule -> work_scheduled (with committed fix date)
--   resolve  -> resolved_pending_check (riders + telemetry must agree to close)
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_authority_action(
  p_hazard uuid, p_officer uuid, p_action text,
  p_lat double precision, p_lon double precision,
  p_note text DEFAULT NULL, p_evidence_url text DEFAULT NULL,
  p_fix_date date DEFAULT NULL)
RETURNS hazard_status LANGUAGE plpgsql AS $$
DECLARE
  u     safar.app_users%ROWTYPE;
  h     safar.road_hazards%ROWTYPE;
  t     safar.tickets%ROWTYPE;
  v_loc geography := safar.fn_point(p_lat, p_lon);
  v_new hazard_status;
  v_parent uuid;
BEGIN
  SELECT * INTO u FROM safar.app_users WHERE id = p_officer;
  SELECT * INTO h FROM safar.road_hazards WHERE id = p_hazard FOR UPDATE;
  SELECT * INTO t FROM safar.tickets WHERE hazard_id = p_hazard;

  IF u.role <> 'authority_officer' THEN
    RAISE EXCEPTION 'only authority officers may perform %', p_action;
  END IF;
  -- Geofenced accountability: own jurisdiction, or the ticket was escalated to you
  IF NOT EXISTS (SELECT 1 FROM safar.agencies a
                  WHERE a.id = u.agency_id AND ST_Covers(a.boundary, h.location))
     AND coalesce(t.assigned_agency_id <> u.agency_id, true) THEN
    RAISE EXCEPTION 'hazard is outside officer jurisdiction';
  END IF;
  -- Site presence for field actions
  IF p_action IN ('verify','resolve') AND NOT ST_DWithin(v_loc, h.location, 200) THEN
    RAISE EXCEPTION '% requires a site visit: officer is % m away', p_action,
      round(ST_Distance(v_loc, h.location)::numeric);
  END IF;
  IF p_action = 'resolve' AND p_evidence_url IS NULL THEN
    RAISE EXCEPTION 'resolve requires a geotagged after-photo';
  END IF;

  CASE p_action
    WHEN 'verify' THEN
      v_new := 'authority_verified';
      UPDATE safar.road_hazards
         SET status = v_new, trust_tier = 1, confidence = greatest(confidence, 0.95),
             last_confirmed_at = now(), owner_agency_id = coalesce(owner_agency_id, u.agency_id)
       WHERE id = p_hazard;
      PERFORM safar.fn_open_ticket(p_hazard);
      UPDATE safar.tickets SET status = 'acknowledged', acknowledged_at = now()
       WHERE hazard_id = p_hazard AND status = 'open';
      PERFORM safar.fn_log(p_hazard, 'verified', p_officer, h.status, v_new, v_loc, p_note, p_evidence_url);

    WHEN 'reject' THEN
      IF p_note IS NULL THEN RAISE EXCEPTION 'reject requires a reason'; END IF;
      IF h.status = 'community_verified' AND h.confidence >= 0.80 THEN
        -- Do not let a single office silently erase what many riders see:
        SELECT parent_agency_id INTO v_parent FROM safar.agencies WHERE id = u.agency_id;
        IF v_parent IS NOT NULL THEN
          UPDATE safar.tickets SET assigned_agency_id = v_parent,
                                   escalation_level = escalation_level + 1,
                                   next_escalation_at = now() + interval '72 hours'
           WHERE hazard_id = p_hazard;
        END IF;
        PERFORM safar.fn_log(p_hazard, 'escalated', p_officer, h.status, h.status, v_loc,
                             'Rejection of high-confidence community hazard sent for review: ' || p_note);
        RETURN h.status;
      END IF;
      v_new := 'dismissed';
      UPDATE safar.road_hazards SET status = v_new WHERE id = p_hazard;
      UPDATE safar.tickets SET status = 'closed' WHERE hazard_id = p_hazard;
      PERFORM safar.fn_log(p_hazard, 'rejected', p_officer, h.status, v_new, v_loc, p_note);

    WHEN 'schedule' THEN
      IF p_fix_date IS NULL THEN RAISE EXCEPTION 'schedule requires a fix date'; END IF;
      v_new := 'work_scheduled';
      UPDATE safar.road_hazards SET status = v_new, trust_tier = 1 WHERE id = p_hazard;
      PERFORM safar.fn_open_ticket(p_hazard);
      UPDATE safar.tickets SET status = 'in_progress', scheduled_fix_date = p_fix_date,
                               acknowledged_at = coalesce(acknowledged_at, now())
       WHERE hazard_id = p_hazard;
      PERFORM safar.fn_log(p_hazard, 'work_scheduled', p_officer, h.status, v_new, v_loc,
                           coalesce(p_note, '') || ' fix by ' || p_fix_date);

    WHEN 'resolve' THEN
      v_new := 'resolved_pending_check';
      UPDATE safar.road_hazards
         SET status = v_new, resolved_at = now(),
             smooth_passes_since_resolve = 0, jolt_passes_since_resolve = 0,
             photo_urls = array_append(photo_urls, p_evidence_url)
       WHERE id = p_hazard;
      UPDATE safar.tickets SET status = 'resolved', resolved_at = now() WHERE hazard_id = p_hazard;
      PERFORM safar.fn_log(p_hazard, 'resolved', p_officer, h.status, v_new, v_loc, p_note, p_evidence_url);

    ELSE
      RAISE EXCEPTION 'unknown action %', p_action;
  END CASE;

  RETURN v_new;
END $$;

-- -----------------------------------------------------------------------------
-- Tier 3: anonymous pass reports (phone drove over a known hazard)
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_record_pass(p_hazard uuid, p_jolted boolean)
RETURNS hazard_status LANGUAGE plpgsql AS $$
BEGIN
  UPDATE safar.road_hazards
     SET jolt_passes_since_resolve   = jolt_passes_since_resolve   + (CASE WHEN p_jolted THEN 1 ELSE 0 END),
         smooth_passes_since_resolve = smooth_passes_since_resolve + (CASE WHEN p_jolted THEN 0 ELSE 1 END),
         last_confirmed_at = CASE WHEN p_jolted THEN now() ELSE last_confirmed_at END
   WHERE id = p_hazard AND status = 'resolved_pending_check';
  RETURN safar.fn_recompute(p_hazard);
END $$;

-- -----------------------------------------------------------------------------
-- Tier 3: cluster raw telemetry into candidate hazards (run every 15-60 min)
--   DBSCAN in metres (EPSG:7755), then require N DISTINCT devices per cluster.
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_cluster_telemetry(
  p_eps_m        double precision DEFAULT 12,
  p_min_devices  integer          DEFAULT 4,
  p_window       interval         DEFAULT interval '14 days')
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  c        record;
  v_hid    uuid;
  v_type   text;
  v_owner  uuid; v_seg bigint;
  v_made   integer := 0;
  v_ht     safar.hazard_types%ROWTYPE;
BEGIN
  DROP TABLE IF EXISTS _tel;
  CREATE TEMP TABLE _tel ON COMMIT DROP AS
  SELECT e.*,
         ST_ClusterDBSCAN(ST_Transform(e.location::geometry, 7755),
                          eps := CASE WHEN e.kind IN ('hard_brake','swerve') THEN p_eps_m * 3 ELSE p_eps_m END,
                          minpoints := 2)
           OVER (PARTITION BY (e.kind IN ('hard_brake','swerve'))) AS cid,
         (e.kind IN ('hard_brake','swerve')) AS is_brake
    FROM safar.telemetry_events e
   WHERE NOT e.processed AND e.recorded_at > now() - p_window;

  FOR c IN
    SELECT is_brake, cid,
           ST_Centroid(ST_Collect(location::geometry))::geography          AS centre,
           count(DISTINCT device_pseudonym)                                 AS devices,
           mode() WITHIN GROUP (ORDER BY kind)                              AS dom_kind,
           avg(peak_g)                                                      AS mean_g,
           max(recorded_at)                                                 AS last_seen,
           array_agg(id)                                                    AS ids
      FROM _tel WHERE cid IS NOT NULL
     GROUP BY is_brake, cid
    HAVING count(DISTINCT device_pseudonym) >= p_min_devices
  LOOP
    v_type := CASE
                WHEN c.is_brake                                           THEN 'near_miss_hotspot'
                WHEN c.dom_kind = 'vertical_jolt_hump'                    THEN 'speed_breaker_unmarked'
                WHEN c.dom_kind = 'vertical_jolt_pothole' AND c.mean_g >= 1.2 THEN 'crater_deep_pothole'
                ELSE 'pothole' END;
    SELECT * INTO v_ht FROM safar.hazard_types WHERE code = v_type;

    -- Attach to an existing compatible hazard (any pothole/hump family) if one is near
    SELECT h.id INTO v_hid
      FROM safar.road_hazards h
     WHERE h.status NOT IN ('closed','dismissed','expired')
       AND ST_DWithin(coalesce(h.extent, h.location), c.centre, greatest(v_ht.dedupe_radius_m, 15))
       AND h.hazard_type = ANY (CASE
             WHEN v_type IN ('pothole','crater_deep_pothole')
               THEN ARRAY['pothole','crater_deep_pothole','pothole_dense_stretch']
             WHEN v_type = 'speed_breaker_unmarked'
               THEN ARRAY['speed_breaker_unmarked','speed_breaker_marked','rumble_strips']
             ELSE ARRAY[v_type] END)
     ORDER BY h.location <-> c.centre LIMIT 1;

    IF v_hid IS NULL THEN
      SELECT agency_id, segment_id INTO v_owner, v_seg FROM safar.fn_resolve_owner(c.centre);
      INSERT INTO safar.road_hazards
            (hazard_type, location, severity, status, trust_tier, confidence, telemetry_hits,
             owner_agency_id, road_segment_id, first_reported_at, last_confirmed_at, expires_at)
      VALUES (v_type, c.centre, v_ht.default_severity, 'candidate', 3, 0.30, c.devices,
              v_owner, v_seg, c.last_seen, c.last_seen,
              CASE WHEN v_ht.ttl_hours IS NOT NULL
                   THEN c.last_seen + make_interval(hours => v_ht.ttl_hours) END)
      RETURNING id INTO v_hid;
      PERFORM safar.fn_log(v_hid, 'created', NULL, NULL, 'candidate', c.centre,
                           format('telemetry cluster: %s devices, mean %s g', c.devices, round(c.mean_g, 2)));
      v_made := v_made + 1;
    ELSE
      UPDATE safar.road_hazards
         SET telemetry_hits    = telemetry_hits + c.devices,
             last_confirmed_at = greatest(last_confirmed_at, c.last_seen),
             -- jolts after an agency "fix" count as evidence the fix failed
             jolt_passes_since_resolve = jolt_passes_since_resolve +
               CASE WHEN status = 'resolved_pending_check' AND c.last_seen > resolved_at
                    THEN c.devices ELSE 0 END
       WHERE id = v_hid;
    END IF;

    UPDATE safar.telemetry_events SET processed = true, clustered_into = v_hid
     WHERE id = ANY (c.ids);
    PERFORM safar.fn_recompute(v_hid);
  END LOOP;

  -- Old unclustered noise: mark processed so it is not rescanned forever
  UPDATE safar.telemetry_events SET processed = true
   WHERE NOT processed AND recorded_at <= now() - p_window;

  RETURN v_made;
END $$;

-- -----------------------------------------------------------------------------
-- Housekeeping: expire transient hazards, escalate overdue tickets (pg_cron 5 min)
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_housekeeping(OUT expired integer, OUT escalated integer)
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  expired := 0; escalated := 0;

  FOR r IN SELECT id, status FROM safar.road_hazards
            WHERE expires_at < now()
              AND status IN ('candidate','community_verified','authority_verified')
  LOOP
    UPDATE safar.road_hazards SET status = 'expired' WHERE id = r.id;
    UPDATE safar.tickets SET status = 'closed' WHERE hazard_id = r.id;
    PERFORM safar.fn_log(r.id, 'expired', NULL, r.status, 'expired', NULL, 'TTL elapsed without reconfirmation');
    expired := expired + 1;
  END LOOP;

  FOR r IN SELECT t.id, t.hazard_id, t.assigned_agency_id, a.parent_agency_id, h.status, sp.escalate_after_hours
             FROM safar.tickets t
             JOIN safar.agencies a      ON a.id = t.assigned_agency_id
             JOIN safar.road_hazards h  ON h.id = t.hazard_id
             JOIN safar.sla_policies sp ON sp.severity = h.severity
            WHERE t.status IN ('open','acknowledged','in_progress')
              AND t.next_escalation_at < now()
  LOOP
    UPDATE safar.tickets
       SET assigned_agency_id = coalesce(r.parent_agency_id, r.assigned_agency_id),
           escalation_level   = escalation_level + 1,
           next_escalation_at = now() + make_interval(hours => r.escalate_after_hours)
     WHERE id = r.id;
    PERFORM safar.fn_log(r.hazard_id, 'escalated', NULL, r.status, r.status, NULL,
      CASE WHEN r.parent_agency_id IS NULL THEN 'overdue at top of ladder: flagged on public scorecard'
           ELSE 'overdue: escalated to parent agency' END);
    escalated := escalated + 1;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Rider-facing spatial queries
-- -----------------------------------------------------------------------------

-- Live = alert-worthy statuses. resolved_pending_check stays live (softened on device)
-- until riders/telemetry confirm the fix: a premature closure must never silence a crater.
CREATE FUNCTION fn_is_live(s hazard_status) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT s IN ('candidate','community_verified','authority_verified','work_scheduled','resolved_pending_check')
$$;

-- (A) Radius lookup, nearest first. ST_DWithin uses the GIST index; <-> orders by KNN.
CREATE FUNCTION fn_hazards_near(p_lat double precision, p_lon double precision,
                                p_radius_m double precision DEFAULT 1000,
                                p_min_confidence numeric DEFAULT 0.30)
RETURNS TABLE (hazard_id uuid, hazard_type text, severity severity_level, status hazard_status,
               trust_tier smallint, confidence numeric, distance_m double precision,
               bearing_to_deg double precision, lat double precision, lon double precision)
LANGUAGE sql STABLE AS $$
  WITH me AS (SELECT safar.fn_point(p_lat, p_lon) AS g)
  SELECT h.id, h.hazard_type, h.severity, h.status, h.trust_tier, h.confidence,
         ST_Distance(h.location, me.g)                        AS distance_m,
         degrees(ST_Azimuth(me.g, h.location))                AS bearing_to_deg,
         ST_Y(h.location::geometry), ST_X(h.location::geometry)
    FROM safar.road_hazards h, me
   WHERE ST_DWithin(h.location, me.g, p_radius_m)
     -- literal list (not fn_is_live) so the planner can use the partial index road_hazards_live_gix
     AND h.status IN ('candidate','community_verified','authority_verified','work_scheduled','resolved_pending_check')
     AND h.confidence >= p_min_confidence
   ORDER BY h.location <-> me.g
$$;

-- (B) Route-trajectory intersection: hazards inside a corridor around a planned route,
--     ordered by distance ALONG the route, with direction filtering for directional types.
--     p_route_wkt: 'LINESTRING(lon lat, lon lat, ...)'
CREATE FUNCTION fn_hazards_along_route(p_route_wkt text,
                                       p_corridor_m double precision DEFAULT 25,
                                       p_min_confidence numeric DEFAULT 0.30)
RETURNS TABLE (hazard_id uuid, hazard_type text, severity severity_level, status hazard_status,
               confidence numeric, dist_along_m double precision, lateral_m double precision,
               route_bearing_deg double precision, applies boolean)
LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT ST_GeogFromText('SRID=4326;' || p_route_wkt)              AS g,
           ST_GeomFromText(p_route_wkt, 4326)                         AS geom,
           ST_Length(ST_GeogFromText('SRID=4326;' || p_route_wkt))    AS len_m
  ),
  hits AS (
    SELECT h.*, ht.directional,
           -- for stretches use the earliest point of the stretch along the route
           CASE WHEN h.extent IS NULL
                THEN ST_LineLocatePoint(r.geom, h.location::geometry)
                ELSE least(ST_LineLocatePoint(r.geom, ST_StartPoint(h.extent::geometry)),
                           ST_LineLocatePoint(r.geom, ST_EndPoint(h.extent::geometry)))
           END AS frac,
           ST_Distance(coalesce(h.extent, h.location), r.g) AS lateral_m
      FROM safar.road_hazards h
      JOIN safar.hazard_types ht ON ht.code = h.hazard_type
      CROSS JOIN r
     WHERE ST_DWithin(coalesce(h.extent, h.location), r.g, p_corridor_m)   -- GIST-backed
       AND h.status IN ('candidate','community_verified','authority_verified','work_scheduled','resolved_pending_check')
       AND h.confidence >= p_min_confidence
       AND ht.rider_alert
  )
  SELECT hits.id, hits.hazard_type, hits.severity, hits.status, hits.confidence,
         hits.frac * r.len_m AS dist_along_m,
         hits.lateral_m,
         b.route_bearing,
         (NOT hits.directional
          OR safar.fn_bearing_diff(hits.bearing_deg, round(b.route_bearing)::int) <= 50) AS applies
    FROM hits CROSS JOIN r
    CROSS JOIN LATERAL (
      SELECT degrees(ST_Azimuth(
               ST_LineInterpolatePoint(r.geom, greatest(hits.frac - 15 / nullif(r.len_m, 0), 0))::geography,
               ST_LineInterpolatePoint(r.geom, least(hits.frac + 15 / nullif(r.len_m, 0), 1))::geography
             )) AS route_bearing
    ) b
   ORDER BY dist_along_m
$$;

-- -----------------------------------------------------------------------------
-- Offline sync
-- -----------------------------------------------------------------------------

-- Geohash-5 tiles covering a route corridor (for bounding-box prefetch before a trip)
CREATE FUNCTION fn_tiles_for_route(p_route_wkt text, p_buffer_m double precision DEFAULT 2000)
RETURNS text[] LANGUAGE sql STABLE AS $$
  WITH buf AS (
    SELECT ST_Buffer(ST_Transform(ST_GeomFromText(p_route_wkt, 4326), 7755), p_buffer_m) AS b
  ),
  samples AS (
    SELECT ST_Transform(ST_Centroid(g.geom), 4326) AS p
      FROM buf, ST_SquareGrid(1000, buf.b) g
     WHERE ST_Intersects(g.geom, buf.b)
    UNION ALL
    SELECT ST_Transform((ST_DumpPoints(ST_Boundary(buf.b))).geom, 4326) FROM buf
  )
  SELECT array_agg(DISTINCT ST_GeoHash(p, 5) ORDER BY ST_GeoHash(p, 5)) FROM samples
$$;

-- Delta pull: everything in these tiles with sync_version > since.
-- Non-live rows are returned as tombstones so phones delete them locally.
CREATE FUNCTION fn_sync_delta(p_tiles text[], p_since bigint, p_limit integer DEFAULT 5000)
RETURNS TABLE (hazard_id uuid, hazard_type text, lat double precision, lon double precision,
               extent_geojson text, bearing_deg smallint, severity severity_level,
               status hazard_status, trust_tier smallint, confidence numeric,
               active_when active_condition, two_wheeler_boost boolean,
               expires_at timestamptz, tile_gh5 text, sync_version bigint, tombstone boolean)
LANGUAGE sql STABLE AS $$
  SELECT h.id, h.hazard_type, ST_Y(h.location::geometry), ST_X(h.location::geometry),
         ST_AsGeoJSON(h.extent), h.bearing_deg, h.severity, h.status, h.trust_tier, h.confidence,
         ht.active_when, ht.two_wheeler_boost, h.expires_at, h.tile_gh5, h.sync_version,
         NOT (safar.fn_is_live(h.status) AND ht.rider_alert) AS tombstone
    FROM safar.road_hazards h
    JOIN safar.hazard_types ht ON ht.code = h.hazard_type
   WHERE h.tile_gh5 = ANY (p_tiles)
     AND h.sync_version > p_since
   ORDER BY h.sync_version
   LIMIT p_limit
$$;
