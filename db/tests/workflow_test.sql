-- =============================================================================
--  End-to-end workflow test. Run on a fresh DB after 001-003:
--    psql -d safar -v ON_ERROR_STOP=1 -f tests/workflow_test.sql
--  Fictional village near Tirupati, AP. Every step ASSERTs its expected outcome.
-- =============================================================================
SET search_path = safar, public;
SET client_min_messages = notice;

-- ---------- Fixtures ----------------------------------------------------------
INSERT INTO agencies (id, name, agency_type, parent_agency_id, state_code, district, boundary) VALUES
 ('00000000-0000-0000-0000-0000000000d1','Tirupati District Collectorate','district_admin', NULL,'AP','Tirupati',
   ST_GeogFromText('SRID=4326;MULTIPOLYGON(((79.30 13.50,79.60 13.50,79.60 13.75,79.30 13.75,79.30 13.50)))')),
 ('00000000-0000-0000-0000-0000000000a1','Example Mandal Parishad','mandal_parishad','00000000-0000-0000-0000-0000000000d1','AP','Tirupati',
   ST_GeogFromText('SRID=4326;MULTIPOLYGON(((79.35 13.55,79.48 13.55,79.48 13.68,79.35 13.68,79.35 13.55)))')),
 ('00000000-0000-0000-0000-0000000000b1','Example Gram Panchayat','gram_panchayat','00000000-0000-0000-0000-0000000000a1','AP','Tirupati',
   ST_GeogFromText('SRID=4326;MULTIPOLYGON(((79.40 13.60,79.42 13.60,79.42 13.62,79.40 13.62,79.40 13.60)))')),
 ('00000000-0000-0000-0000-0000000000c1','NHAI PIU Tirupati','nhai','00000000-0000-0000-0000-0000000000d1','AP','Tirupati',
   ST_GeogFromText('SRID=4326;MULTIPOLYGON(((79.429 13.50,79.431 13.50,79.431 13.75,79.429 13.75,79.429 13.50)))'));

INSERT INTO road_segments (name, road_class, ref, owner_agency_id, geom, speed_limit_kmh, is_lit, has_median) VALUES
 ('Village main road','village_road',NULL,'00000000-0000-0000-0000-0000000000b1',
   ST_GeogFromText('SRID=4326;LINESTRING(79.400 13.610, 79.420 13.610)'), 40, false, false),
 ('NH stretch','national_highway','NH71','00000000-0000-0000-0000-0000000000c1',
   ST_GeogFromText('SRID=4326;LINESTRING(79.430 13.55, 79.430 13.70)'), 80, false, true);

INSERT INTO app_users (id, role, agency_id, device_attested, reputation) VALUES
 ('00000000-0000-0000-0000-000000000001','rider',            NULL, true, 1.0),
 ('00000000-0000-0000-0000-000000000002','gig_rider',        NULL, true, 1.0),
 ('00000000-0000-0000-0000-000000000003','rider',            NULL, false,1.0),
 ('00000000-0000-0000-0000-000000000004','trusted_reporter', NULL, true, 1.0),
 ('00000000-0000-0000-0000-0000000000f1','authority_officer','00000000-0000-0000-0000-0000000000b1', true, 1.0),
 ('00000000-0000-0000-0000-0000000000f2','authority_officer','00000000-0000-0000-0000-0000000000c1', true, 1.0);

-- ---------- Scenario -----------------------------------------------------------
DO $$
DECLARE
  h1 uuid; h1b uuid; h2 uuid; h3 uuid; hx uuid;
  s  hazard_status;
  r  record;
  n  int;
  ok boolean;
BEGIN
  -- 1. A rider reports a pothole on the village road -> candidate, Tier 2, not yet ticketed
  h1 := fn_submit_report(gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'pothole',
                         13.6100, 79.4100, 90, 32, 6);
  SELECT * INTO r FROM road_hazards WHERE id = h1;
  ASSERT r.status = 'candidate' AND r.trust_tier = 2, '1: expected candidate tier 2';
  ASSERT r.owner_agency_id = '00000000-0000-0000-0000-0000000000b1', '1: owner should resolve to panchayat';
  ASSERT NOT EXISTS (SELECT 1 FROM tickets WHERE hazard_id = h1), '1: no ticket yet';
  RAISE NOTICE '1  pothole reported -> % (conf %)', r.status, r.confidence;

  -- 2. Idempotent replay of the same offline report id returns same hazard, no duplicate
  PERFORM fn_submit_report('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000002',
                           'pothole', 13.61005, 79.41006, 90, 28, 8);
  h1b := fn_submit_report('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000002',
                          'pothole', 13.61005, 79.41006, 90, 28, 8);
  ASSERT h1b = h1, '2: second rider 8 m away must merge into same hazard';
  SELECT count(*) INTO n FROM hazard_reports WHERE id = '11111111-1111-1111-1111-111111111111';
  ASSERT n = 1, '2: replay must not duplicate report';
  SELECT * INTO r FROM road_hazards WHERE id = h1;
  ASSERT r.status = 'community_verified', '2: two attested riders should reach consensus, got ' || r.status;
  ASSERT EXISTS (SELECT 1 FROM tickets WHERE hazard_id = h1
                 AND assigned_agency_id = '00000000-0000-0000-0000-0000000000b1'), '2: ticket routed to panchayat';
  RAISE NOTICE '2  second rider merged -> % (conf %), ticket opened for panchayat', r.status, r.confidence;

  -- 3. Remote voting is refused (proof of presence)
  BEGIN
    PERFORM fn_cast_vote(h1, '00000000-0000-0000-0000-000000000003', 'deny', 13.70, 79.50);
    ASSERT false, '3: remote vote should have failed';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE '3  remote vote refused: %', SQLERRM;
  END;

  -- 4. Panchayat officer cannot pin hazards on the NH outside their geofence
  BEGIN
    PERFORM fn_submit_report(gen_random_uuid(), '00000000-0000-0000-0000-0000000000f1',
                             'blind_intersection', 13.65, 79.43);
    ASSERT false, '4: out-of-jurisdiction pin should fail';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE '4  out-of-geofence pin refused: %', SQLERRM;
  END;

  -- 5. Officer verify needs site presence
  BEGIN
    PERFORM fn_authority_action(h1, '00000000-0000-0000-0000-0000000000f1', 'verify', 13.6150, 79.4150);
    ASSERT false, '5: desk verification from 700 m should fail';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE '5a desk verify refused: %', SQLERRM;
  END;
  s := fn_authority_action(h1, '00000000-0000-0000-0000-0000000000f1', 'verify', 13.6101, 79.4101,
                           'Site inspected, 40 cm wide');
  SELECT * INTO r FROM road_hazards WHERE id = h1;
  ASSERT s = 'authority_verified' AND r.trust_tier = 1 AND r.confidence >= 0.95, '5: verify -> tier 1';
  ASSERT (SELECT status FROM tickets WHERE hazard_id = h1) = 'acknowledged', '5: ticket acknowledged';
  RAISE NOTICE '5b site verify -> % tier % conf %', s, r.trust_tier, r.confidence;

  -- 6. Resolve requires evidence; after resolve the hazard stays live (soft) pending check
  BEGIN
    PERFORM fn_authority_action(h1, '00000000-0000-0000-0000-0000000000f1', 'resolve', 13.6100, 79.4100);
    ASSERT false, '6: resolve without photo should fail';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE '6a resolve without photo refused: %', SQLERRM;
  END;
  s := fn_authority_action(h1, '00000000-0000-0000-0000-0000000000f1', 'resolve', 13.6100, 79.4100,
                           'Patched', 'https://cdn.example/after.jpg');
  ASSERT s = 'resolved_pending_check', '6: resolve -> pending check';
  ASSERT EXISTS (SELECT 1 FROM fn_hazards_near(13.6100, 79.4095, 200) WHERE hazard_id = h1),
         '6: pending-check hazard must still be returned to riders';
  RAISE NOTICE '6b resolved -> % (still visible to riders)', s;

  -- 7. Physics disagrees: 6 of 8 passes still jolt -> automatic reopen + ticket back in progress
  FOR i IN 1..6 LOOP PERFORM fn_record_pass(h1, true);  END LOOP;
  FOR i IN 1..2 LOOP PERFORM fn_record_pass(h1, false); END LOOP;
  SELECT status INTO s FROM road_hazards WHERE id = h1;
  ASSERT s = 'authority_verified', '7: failed fix should reopen, got ' || s;
  ASSERT (SELECT status FROM tickets WHERE hazard_id = h1) = 'in_progress', '7: ticket back to in_progress';
  ASSERT EXISTS (SELECT 1 FROM hazard_events WHERE hazard_id = h1 AND action = 'reopened'), '7: reopen logged';
  RAISE NOTICE '7  6/8 jolting passes after "fix" -> reopened as %', s;

  -- 8. Real fix: resolve again, 22 smooth passes -> closed
  PERFORM fn_authority_action(h1, '00000000-0000-0000-0000-0000000000f1', 'resolve', 13.6100, 79.4100,
                              'Re-laid properly', 'https://cdn.example/after2.jpg');
  FOR i IN 1..22 LOOP PERFORM fn_record_pass(h1, false); END LOOP;
  SELECT status INTO s FROM road_hazards WHERE id = h1;
  ASSERT s = 'closed', '8: smooth passes should close, got ' || s;
  ASSERT (SELECT status FROM tickets WHERE hazard_id = h1) = 'closed', '8: ticket closed';
  RAISE NOTICE '8  22 smooth passes -> %', s;

  -- 9. Tier 3: anonymous jolts from 5 devices at an unreported hump -> candidate
  INSERT INTO telemetry_events (device_pseudonym, kind, location, heading_deg, speed_kmh, peak_g, duration_ms, vehicle_class, recorded_at)
  SELECT digest('dev'||d, 'sha256'), 'vertical_jolt_hump',
         fn_point(13.6100 + (random()-0.5)*0.00008, 79.4160 + (random()-0.5)*0.00008),
         90, 35, 0.8, 420, '2w', now() - (d || ' hours')::interval
    FROM generate_series(1,5) d;
  n := fn_cluster_telemetry();
  SELECT * INTO r FROM road_hazards WHERE hazard_type = 'speed_breaker_unmarked' ORDER BY created_at DESC LIMIT 1;
  h2 := r.id;
  ASSERT n = 1 AND r.trust_tier = 3 AND r.status = 'candidate', '9: telemetry should create tier-3 candidate';
  RAISE NOTICE '9  5-device jolt cluster -> % tier % conf % (%)', r.status, r.trust_tier, r.confidence, r.hazard_type;

  -- 10. More devices next day: crosses the telemetry-only promotion bar
  INSERT INTO telemetry_events (device_pseudonym, kind, location, heading_deg, speed_kmh, peak_g, duration_ms, vehicle_class, recorded_at)
  SELECT digest('dev2'||d, 'sha256'), 'vertical_jolt_hump',
         fn_point(13.6100 + (random()-0.5)*0.00008, 79.4160 + (random()-0.5)*0.00008),
         270, 30, 0.7, 400, '3w', now() - interval '10 minutes'
    FROM generate_series(1,4) d;
  PERFORM fn_cluster_telemetry();
  SELECT * INTO r FROM road_hazards WHERE id = h2;
  ASSERT r.status = 'community_verified' AND r.telemetry_hits = 9, '10: expected promotion on 9 devices, got ' || r.status || '/' || r.telemetry_hits;
  RAISE NOTICE '10 9 devices total -> % conf %', r.status, r.confidence;

  -- 11. Directional hazard on the NH: parked truck facing north (bearing 0)
  h3 := fn_submit_report(gen_random_uuid(), '00000000-0000-0000-0000-0000000000f2', 'parked_heavy_vehicle',
                         13.6300, 79.4300, 0, 0, 5, NULL, 'Unlit trailer on left shoulder');
  ASSERT (SELECT trust_tier FROM road_hazards WHERE id = h3) = 1, '11: NHAI officer pin = Tier 1';

  -- Northbound route: truck applies. Southbound route: same truck does not.
  SELECT applies INTO ok FROM fn_hazards_along_route('LINESTRING(79.4301 13.60, 79.4301 13.66)', 25)
   WHERE hazard_id = h3;
  ASSERT ok, '11: should apply northbound';
  SELECT applies INTO ok FROM fn_hazards_along_route('LINESTRING(79.4301 13.66, 79.4301 13.60)', 25)
   WHERE hazard_id = h3;
  ASSERT NOT ok, '11: should not apply southbound';
  RAISE NOTICE '11 directional filter: northbound applies, southbound suppressed';

  -- 12. Route query across the village road returns hazards ordered along the route
  FOR r IN SELECT * FROM fn_hazards_along_route('LINESTRING(79.4000 13.6100, 79.4200 13.6100)', 25) LOOP
    RAISE NOTICE '12 along-route: % at % m (lateral % m, applies %)',
      r.hazard_type, round(r.dist_along_m::numeric), round(r.lateral_m::numeric,1), r.applies;
  END LOOP;

  -- 13. Offline: tiles for a route + delta pull + tombstones
  SELECT count(*) INTO n FROM fn_sync_delta(fn_tiles_for_route('LINESTRING(79.4000 13.6100, 79.4200 13.6100)', 2000), 0);
  ASSERT n >= 2, '13: delta should include village hazards';
  ASSERT (SELECT tombstone FROM fn_sync_delta(fn_tiles_for_route('LINESTRING(79.4000 13.6100, 79.4200 13.6100)', 2000), 0)
           WHERE hazard_id = h1), '13: closed hazard must sync as tombstone';
  RAISE NOTICE '13 tiles % -> % delta rows (closed pothole sent as tombstone)',
    fn_tiles_for_route('LINESTRING(79.4000 13.6100, 79.4200 13.6100)', 2000), n;

  -- 14. Escalation: panchayat sits on the speed-breaker ticket past its deadline
  UPDATE tickets SET next_escalation_at = now() - interval '1 minute' WHERE hazard_id = h2;
  PERFORM fn_housekeeping();
  ASSERT (SELECT assigned_agency_id FROM tickets WHERE hazard_id = h2) = '00000000-0000-0000-0000-0000000000a1',
         '14: overdue ticket should climb to mandal';
  RAISE NOTICE '14 overdue ticket escalated panchayat -> mandal parishad';

  -- 15. Transient expiry
  UPDATE road_hazards SET expires_at = now() - interval '1 minute' WHERE id = h3;
  PERFORM fn_housekeeping();
  ASSERT (SELECT status FROM road_hazards WHERE id = h3) = 'expired', '15: parked truck should expire';
  RAISE NOTICE '15 parked-truck pin expired after TTL';

  -- 16. Audit log is append-only and hash-chained
  BEGIN
    UPDATE hazard_events SET note = 'tampered' WHERE hazard_id = h1;
    ASSERT false, '16: tamper should fail';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE '16 audit tamper refused: %', SQLERRM;
  END;
  SELECT bool_and(e.prev_hash IS NOT DISTINCT FROM p.row_hash) INTO ok
    FROM (SELECT id, prev_hash, lag(row_hash) OVER (ORDER BY id) AS row_hash
            FROM hazard_events WHERE hazard_id = h1) e
    JOIN LATERAL (SELECT e.row_hash) p ON true;
  ASSERT ok, '16: hash chain broken';
  SELECT count(*) INTO n FROM hazard_events WHERE hazard_id = h1;
  RAISE NOTICE '16 hash chain intact across % events', n;
END $$;

-- ---------- Public scorecard ----------
SELECT name, agency_type, open_tickets, overdue_tickets, open_critical, median_hours_to_resolve, ever_escalated
  FROM v_agency_scorecard ORDER BY name;

-- ---------- Query plan check: radius lookup must use the GIST index ----------
SET enable_seqscan = off;
EXPLAIN (COSTS OFF)
SELECT id FROM road_hazards
 WHERE ST_DWithin(location, fn_point(13.61, 79.41), 500)
   AND status IN ('candidate','community_verified','authority_verified','work_scheduled','resolved_pending_check');
