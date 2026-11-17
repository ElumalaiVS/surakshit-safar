# Surakshit Safar

A survival-first road hazard co-pilot for Indian commuters, gig riders and first-time travellers. It warns riders early about unmarked speed breakers, craters, parked trucks, wrong-side zones and dark stretches, using hazard data verified by the agency that owns the road.

**SafeGrid Analytics**, the web dashboard for citizens, control rooms and officials, is in [`web/`](web/README.md). Open `web/dist/index.html` in a browser to try it.

**Read [`DESIGN.md`](DESIGN.md) first**: it covers the problem, governance model, taxonomy, schema, offline architecture and alert UX.

```
surakshit-safar/
├── DESIGN.md                      full system design (6 pillars + pilot plan)
├── db/                            PostgreSQL 15+ / PostGIS 3.3+
│   ├── 001_schema.sql             tables, enums, GIST/partial indexes, triggers, scorecard view
│   ├── 002_taxonomy_seed.sql      26 hazard types, Telugu/Hindi labels, SLA policy
│   ├── 003_functions.sql          trust model, officer workflow, telemetry clustering,
│   │                              escalation, radius + route queries, offline sync
│   ├── 004_api.sql                phone<->server contract: exactly-once outbox, paged tile sync
│   ├── run_tests.sh               rebuild schema + run both test suites
│   └── tests/                     workflow_test.sql (16 steps), api_test.sql (6 steps)
├── android/                       Kotlin Android app — see android/README_ANDROID.md
│   ├── core/                      pure-Kotlin engine, speed coach, detectors, tone synth (40 JUnit tests)
│   └── app/                       foreground service, overlay, cues, SQLite cache, sync, Compose UI
├── web/                           SafeGrid Analytics dashboard (React + Tailwind) — see web/README.md
└── edge/                          reference engine in TypeScript (spec + tests the Kotlin port mirrors)
    ├── sql/edge_schema.sql        SQLite cache: hazards + R*Tree, tiles, outbox, familiarity
    ├── src/geo.ts                 haversine, bearings, polyline projection, geohash
    ├── src/taxonomy.ts            client taxonomy, haptic/earcon vocabulary, te/hi/en labels
    ├── src/alertEngine.ts         CoPilotEngine: lookahead, relevance, anti-fatigue, cues
    ├── src/joltDetector.ts        Tier-3 pothole/hump detection + hard-brake detection
    └── test/                      22 tests (node:test)
```

## Run the database tests

```bash
# PostgreSQL 16 + PostGIS 3 (Ubuntu: apt install postgresql-16-postgis-3)
createdb safar
DB=safar ./db/run_tests.sh
```

Expected: 16 `NOTICE` lines walking through report → consensus → officer verify → fake fix reopened by jolts → real fix closed → telemetry-detected hump → directional route query → offline tiles → escalation → expiry → audit chain intact. After that come the agency scorecard and an `EXPLAIN` plan showing the partial GIST index.

## Run the edge tests

```bash
cd edge
node --test test/*.test.ts        # Node 22.18+ runs TypeScript directly, no build step
npm install && npm run typecheck  # optional: strict tsc
```

## Key entry points

| Need | Call |
|---|---|
| Rider reports a hazard (works offline; idempotent on UUID) | `safar.fn_submit_report(uuid, user, type, lat, lon, heading, speed, accuracy, photo, note, reported_at)` |
| Rider confirms / denies / says fixed (must be within 150 m) | `safar.fn_cast_vote(hazard, user, vote_kind, lat, lon)` |
| Officer verify / reject / schedule / resolve (geofenced, site-checked) | `safar.fn_authority_action(hazard, officer, action, lat, lon, note, evidence_url, fix_date)` |
| Anonymous "drove over it" report for closure checks | `safar.fn_record_pass(hazard, jolted)` |
| Cluster Tier-3 telemetry (cron, every 15 min) | `safar.fn_cluster_telemetry()` |
| Expire + escalate (cron, every 5 min) | `safar.fn_housekeeping()` |
| Hazards near a point | `safar.fn_hazards_near(lat, lon, radius_m)` |
| Hazards along a route | `safar.fn_hazards_along_route('LINESTRING(lon lat, ...)', corridor_m)` |
| Offline prefetch | `safar.fn_tiles_for_route(wkt, buffer_m)` → `safar.fn_sync_delta(tiles, since_version)` |
| On-device alerts | `new CoPilotEngine(store, {vehicle, mode, lang, route}).update(fix, ctx)` |
