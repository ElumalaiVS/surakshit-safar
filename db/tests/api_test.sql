-- =============================================================================
--  API contract test: runs after workflow_test.sql on the same data.
--  Exercises exactly the payload shapes the Android app sends (Reporter.kt).
-- =============================================================================
SET search_path = safar, public;
SET client_min_messages = notice;

DO $$
DECLARE
  r      text;
  n      int;
  page   jsonb;
  page2  jsonb;
  tiles  jsonb;
  row0   jsonb;
  item   uuid := gen_random_uuid();
  tel    uuid := gen_random_uuid();
  hid    uuid;
BEGIN
  -- 1. report exactly as Reporter.reportHazard builds it; replay is harmless
  r := fn_apply_outbox_item(item, 'report', jsonb_build_object(
         'hazard_type','waterlogging','lat',13.6110,'lon',79.4120,'heading_deg',90,
         'speed_kmh',0.0,'accuracy_m',6.0,'reported_at',now()::text,'note',NULL),
       '00000000-0000-0000-0000-000000000001');
  ASSERT r = 'acked', '1: report should be acked';
  r := fn_apply_outbox_item(item, 'report', '{}'::jsonb, '00000000-0000-0000-0000-000000000001');
  ASSERT r = 'acked', '1: replay returns previous outcome';
  SELECT count(*) INTO n FROM hazard_reports WHERE id = item;
  ASSERT n = 1, '1: exactly one stored report';
  RAISE NOTICE 'A1 report acked; replay ignored';

  -- 2. telemetry replay must not double count
  FOR i IN 1..3 LOOP
    r := fn_apply_outbox_item(tel, 'telemetry', jsonb_build_object(
           'kind','vertical_jolt_pothole','lat',13.6105,'lon',79.4180,'heading_deg',90,
           'speed_kmh',38.5,'peak_g',1.31,'duration_ms',120,'vehicle_class','2w',
           'recorded_at',now()::text,'device_pseudonym', repeat('ab', 32)), NULL);
  END LOOP;
  SELECT count(*) INTO n FROM telemetry_events WHERE peak_g = 1.31;
  ASSERT n = 1, '2: telemetry replayed 3x must store once, got ' || n;
  RAISE NOTICE 'A2 telemetry replayed 3x -> stored once';

  -- 3. permanent errors are rejected (phone drops them) with no partial effects
  ASSERT fn_apply_outbox_item(gen_random_uuid(), 'report',
           '{"hazard_type":"ufo","lat":13.61,"lon":79.41}'::jsonb,
           '00000000-0000-0000-0000-000000000001') = 'rejected', '3: unknown type';
  ASSERT fn_apply_outbox_item(gen_random_uuid(), 'telemetry',
           '{"kind":"teleport","lat":13.61,"lon":79.41}'::jsonb, NULL) = 'rejected', '3: bad enum';
  ASSERT fn_apply_outbox_item(gen_random_uuid(), 'report',
           '{"hazard_type":"pothole","lat":13.61,"lon":79.41}'::jsonb, NULL) = 'rejected', '3: anonymous report';
  ASSERT fn_apply_outbox_item(gen_random_uuid(), 'selfie', '{}'::jsonb, NULL) = 'rejected', '3: unknown kind';
  SELECT detail INTO STRICT r FROM outbox_receipts WHERE kind = 'selfie';
  RAISE NOTICE 'A3 bad items rejected (e.g. "%")', r;

  -- 4. vote from far away is rejected (proof of presence), from nearby acked
  SELECT id INTO hid FROM road_hazards WHERE hazard_type = 'waterlogging' ORDER BY created_at DESC LIMIT 1;
  ASSERT fn_apply_outbox_item(gen_random_uuid(), 'vote',
           jsonb_build_object('hazard_id',hid,'vote','confirm','lat',13.70,'lon',79.50),
           '00000000-0000-0000-0000-000000000002') = 'rejected', '4: far vote';
  ASSERT fn_apply_outbox_item(gen_random_uuid(), 'vote',
           jsonb_build_object('hazard_id',hid,'vote','confirm','lat',13.6111,'lon',79.4121),
           '00000000-0000-0000-0000-000000000002') = 'acked', '4: near vote';
  ASSERT (SELECT status FROM road_hazards WHERE id = hid) = 'community_verified', '4: two people -> verified';
  RAISE NOTICE 'A4 far vote rejected, near vote acked -> community_verified';

  -- 5. sync paging: limit 1 forces has_more; advancing per-tile versions walks every row
  tiles := (SELECT jsonb_agg(jsonb_build_object('gh5', t, 'since', 0))
              FROM unnest(fn_tiles_for_route('LINESTRING(79.4000 13.6100, 79.4200 13.6100)', 2000)) t);
  page := fn_sync_page(tiles, 1);
  ASSERT (page->>'has_more')::boolean, '5: expected more pages';
  ASSERT jsonb_array_length(page->'rows') = 1, '5: one row per page';
  row0 := page->'rows'->0;
  ASSERT row0 ?& ARRAY['hazard_id','hazard_type','lat','lon','extent_geojson','bearing_deg','severity',
                       'status','trust_tier','confidence','expires_at','tile_gh5','sync_version','tombstone'],
         '5: row must carry every field SyncWorker.parseRow reads';
  ASSERT NOT (row0 ? 'rn') AND NOT (row0 ? 'since'), '5: no internal columns leak';

  -- walk all pages the way SyncWorker does
  n := 0;
  LOOP
    page := fn_sync_page(tiles, 1);
    n := n + jsonb_array_length(page->'rows');
    tiles := (SELECT jsonb_agg(jsonb_build_object('gh5', t->>'gh5', 'since',
                greatest((t->>'since')::bigint, coalesce((SELECT max((x->>'sync_version')::bigint)
                  FROM jsonb_array_elements(page->'rows') x WHERE x->>'tile_gh5' = t->>'gh5'), 0))))
                FROM jsonb_array_elements(tiles) t);
    EXIT WHEN NOT (page->>'has_more')::boolean OR n > 50;
  END LOOP;
  page2 := fn_sync_page(tiles, 5000);
  ASSERT jsonb_array_length(page2->'rows') = 0, '5: fully synced client gets nothing new';
  SELECT count(*) INTO STRICT r FROM road_hazards h
   WHERE h.tile_gh5 IN (SELECT jsonb_array_elements(tiles)->>'gh5')
     AND h.status IN ('candidate','community_verified','authority_verified','work_scheduled','resolved_pending_check');
  ASSERT n = r::int, format('5: paged %s rows, expected %s live rows', n, r);
  RAISE NOTICE 'A5 paged sync delivered % live rows one at a time, then nothing new', n;

  -- 6. a change after sync shows up as a delta (and closure arrives as a tombstone)
  UPDATE road_hazards SET status = 'dismissed' WHERE id = hid;
  page := fn_sync_page(tiles, 5000);
  ASSERT jsonb_array_length(page->'rows') = 1
     AND (page->'rows'->0->>'tombstone')::boolean
     AND page->'rows'->0->>'hazard_id' = hid::text, '6: dismissal must sync as a tombstone';
  RAISE NOTICE 'A6 dismissed hazard delivered as tombstone delta';
END $$;
