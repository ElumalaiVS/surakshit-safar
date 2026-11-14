# Surakshit Safar — Survival-First Road Hazard Co-Pilot

**System design: architecture, governance, schema, offline edge and alert engine**

> *Surakshit Safar* ("safe journey") is a working name. Change it freely.

Commercial navigation optimizes for ETA. This system optimizes for **getting home alive**. It runs alongside whatever app the rider already uses (Rapido, Uber, Ola, Swiggy, Google Maps) and warns them early about the things that kill people on Indian roads: unmarked humps, craters, unlit trucks, wrong-side traffic, cattle, and canal edges with no barrier. Hazard data is **verified by the agency that owns the road** rather than trusted blindly from a crowd. Every unresolved hazard stays on a public clock until someone fixes it.

---

## Contents

1. [The macro problem](#1-the-macro-problem-india)
2. [Decentralized governance & verification](#2-decentralized-governance--panchayat-verification-workflow)
3. [Hazard taxonomy](#3-hazard-taxonomy-the-alert-engines-vocabulary)
4. [Geospatial database & spatial indexing](#4-geospatial-database-schema--spatial-indexing)
5. [Offline-first edge architecture](#5-offline-first-edge-architecture--resilience)
6. [Co-pilot alert engine & anti-fatigue UX](#6-co-pilot-alert-engine--anti-notification-fatigue-ux)
7. [Gig-worker companion mode & first-time travellers](#7-gig-worker-companion-mode--first-time-travellers)
8. [Safety, privacy & legal guardrails](#8-safety-privacy--legal-guardrails)
9. [Pilot plan & how we will know it works](#9-pilot-plan--how-we-will-know-it-works)
10. [What is built and tested vs. what is next](#10-what-is-built-and-tested-vs-what-is-next)

### System at a glance

```
 ┌──────────────────────────── RIDER PHONE (offline-first) ─────────────────────────────┐
 │  GPS 1 Hz ─┐                                                                          │
 │  Accel 50Hz├─► JoltDetector / HardBrake ──► Tier-3 events ─┐                          │
 │            └─► CoPilotEngine ◄── SQLite R*Tree hazard cache │                          │
 │                   │  (lookahead, relevance, fatigue rules)  │                          │
 │                   ▼                                         ▼                          │
 │        Cues: voice (te/hi/en) · earcon · haptic · flash   Outbox (reports, votes,     │
 │        Overlay bubble over Rapido / Uber / Maps            passes, telemetry)          │
 └───────────────────────────────▲────────────────────────────┬──────────────────────────┘
                 delta sync by tile + version                 │ idempotent replay
 ┌───────────────────────────────┴────────────────────────────▼──────────────────────────┐
 │  API (stateless)  ──►  PostgreSQL + PostGIS  (schema: safar)                           │
 │     fn_submit_report · fn_cast_vote · fn_record_pass · fn_authority_action             │
 │     fn_cluster_telemetry (every 15 min) · fn_housekeeping (every 5 min, pg_cron)       │
 │     fn_hazards_near · fn_hazards_along_route · fn_tiles_for_route · fn_sync_delta      │
 └───────────────▲───────────────────────────────────────────────┬───────────────────────┘
                 │                                               │
   Officer app (Panchayat / PWD / NHAI)                Public scorecard + weekly
   geofenced inbox, site-verified actions              gram-sabha PDF · iRAD/e-DAR export
```

---

## 1. The macro problem (India)

### 1.1 Scale

| Indicator | Figure | Source |
|---|---|---|
| Road deaths, 2023 | **1,72,890** (4,80,583 crashes, 4,62,825 injured) | MoRTH, *Road Accidents in India 2023* |
| Road deaths, 2024 | **1,77,177** (485 per day) | MoRTH reply to Parliament, Dec 2025 |
| Working age (18–60) share of deaths | **83.4%** | MoRTH 2023 |
| Young men 15–29 | Road crashes are the **single largest cause of death**, more than 1 in 5 deaths | SRS Cause-of-Death data (via Data for India) |
| Two-wheeler riders' share of deaths | **44.8%**; pedestrians 20.4% | MoRTH 2023 |
| Rural share of deaths | **68.5%** | MoRTH 2023 |
| Overspeeding share of deaths | **68.1%**; wrong-side driving 5.5% | MoRTH 2023 |
| No helmet / no seatbelt | ~54,000 / ~16,000 deaths | MoRTH 2023 |
| Potholes | 5,840 crashes, 2,161 deaths (+16% y/y) | MoRTH 2023 via CAG |
| Economic loss | 3–5% of GDP per year | World Bank |
| Under-reporting | ~50% of rural crash deaths may be unreported; WHO classed India's data "unusable" | IIT Delhi study; WHO GHE 2019 via IndiaSpend |

**Effects on families** (World Bank/SaveLIFE, 2021): for poor households the loss equalled **more than 7 months of household income**, against under a month for rich ones. **44%** of rural households in the study reported at least one death after a crash. Income fell by **56%** for low-income rural households. Women carried the caregiving burden. Most crash victims are working-age men, so crashes leave many young widows, who face stigma, disputes over property, and a long fight for compensation.

> On "ICMR studies": the strongest recent ICMR-family source is the 2026 *Indian Journal of Medical Research* viewpoint (Tiwari, Jindal, Mavalankar), which proposes a real-time public Trauma Dashboard modelled on the CPCB AQI. This platform is the rider-facing, hazard-level half of that idea.

### 1.2 Why rural arterials kill

| Risk factor | Mechanism | How this system responds |
|---|---|---|
| Straight, open, unlit stretches | Speed creeps up; 66% of deaths happen on straight roads | `unlit_dark_zone` (night-gated), speed-scaled lookahead |
| Highways through villages | 80 km/h traffic meets 5 km/h pedestrians, cattle, tractors | `village_road_merge`, `high_pedestrian_zone`, `stray_cattle_zone` (dusk) |
| Unmarked humps / sudden craters | Two-wheelers lose control at speed | Critical cues, 2W night boost, Tier-3 auto-detection |
| Parked trucks on shoulders | Rear-end crashes at night: "hit from back" is the top crash type (20% of deaths) | `parked_heavy_vehicle`, directional, 12 h TTL |
| Median gaps & wrong-side shortcuts | Head-on and side collisions | `unmarked_median_gap`, `wrong_side_hot_zone` |
| Canals/embankments without barriers | Run-off-road into water: common in AP and other delta districts | `unprotected_edge_drop` (critical) |
| Delayed golden-hour response | Late discovery at night, long ambulance trips | Out of scope for v1 alerts; crash-detection + 112 hand-off is a v2 module (§10) |
| Data never reaches the panchayat | Black spot status needs 10 deaths over 3 years | Tickets routed to the owning agency the day a hazard is verified |

---

## 2. Decentralized governance & Panchayat verification workflow

### 2.1 Three-tier trust model

| Tier | Source | How it is created | Default confidence | Can alert riders? | Opens a ticket? |
|---|---|---|---|---|---|
| **1: Authority verified** | Officer of the agency that owns the road | Official pin **inside the agency's geofence**, or site-verified action (officer within 200 m) | ≥ 0.95 floor | Yes, full strength | Yes, immediately |
| **2: Community consensus** | Riders, gig partners, trusted reporters | Report + peer votes with **proof of presence** (voter within 150 m) | Weighted, time-decayed (below) | Yes. Spoken as "possible …" while confidence < 0.5 | When promoted to `community_verified` |
| **3: Passive telemetry** | Anonymous accelerometer jolts / hard brakes | DBSCAN cluster with ≥ 4 **distinct devices** within 12 m (36 m for braking) | Grows with device count | Yes, as tentative "possible …", capped at *warning* | When ≥ 6 devices (auto-promotion) |

A hazard's `trust_tier` is the **strongest** evidence that has touched it. Evidence from all tiers adds up.

**Confidence model** (`fn_recompute`):

```
evidence(vote) = weight(user) × exp(−age_days / τ)          τ: transient 0.5 d · semi 30 d · permanent 365 d
weight(user)   = role_weight × reputation × (attested ? 1 : 0.5)
                 role_weight: officer 3.0 · trusted_reporter 2.0 · gig_rider 1.2 · rider 1.0
net            = Σ confirm + 0.35 × telemetry_devices − Σ deny
confidence     = 1 − exp(−max(net, 0) / 1.5)                  → two attested riders ≈ 0.77
Tier-1 floor   = 0.95
```

Promotion: `candidate → community_verified` when confidence ≥ 0.70 **and** (≥ 2 distinct confirmers **or** ≥ 6 telemetry devices). Dismissal: ≥ 3 denials outweighing confirms by 1.5×.

**Anti-gaming controls**: proof-of-presence voting, one live vote per person per hazard, device attestation (Play Integrity / App Attest) halves unattested weight, 30 reports/hour rate limit, GPS accuracy gate (≤ 50 m), stale transient reports rejected, idempotent report IDs so offline replays don't double-count. Every raw report is stored, including rejected ones, so there is an audit trail.

### 2.2 Hazard lifecycle

```
                     report / telemetry cluster
                                │
                                ▼
   ┌──────────── candidate ─────────────┐  ≥3 weighted denials
   │  (Tier 2/3, conf < 0.7)            ├──────────────────────────► dismissed
   │                                    │
   │ consensus ≥0.7 & ≥2 people         │ officer pin inside own geofence
   │ (or ≥6 devices)                    │
   ▼                                    ▼
 community_verified ── officer verify ──► authority_verified ──► work_scheduled
   │  (ticket opens)    (site, ≤200 m)      (Tier 1)              (fix date committed)
   │                                          │                         │
   │                                          └──── officer resolve ────┘
   │                                          (after-photo + site, ≤200 m)
   │                                                     │
   │                                                     ▼
   │                                       resolved_pending_check   ◄── still alerts riders (softened)
   │                                          │                   │
   │              ≥2 riders say "fixed" OR    │                   │ ≥2 riders re-confirm OR
   │              ≥20 smooth passes, <10% jolt│                   │ ≥5 jolting passes, ≥40% jolt
   │                                          ▼                   ▼
   │                                       closed         REOPENED → authority_verified
   │                                                       (ticket back in progress,
   └── transient TTL lapses ──► expired                     strike stays on the record)
```

**The key accountability rule:** an agency **cannot close its own ticket**. "Resolved" only means "the agency says it's fixed". The hazard closes when riders or phone physics agree. A patch that crumbles in a week reopens automatically, and that reopening stays permanently in the hash-chained audit log.

### 2.3 Administrative workflow (Officer app)

| Step | Officer action | System enforcement |
|---|---|---|
| **Inbox** | Sees tickets for their agency, sorted by severity and SLA time left | Only hazards inside their geofence or escalated to them |
| **Pin** | Marks a hazard they found themselves | Must be inside agency boundary → Tier 1 + ticket |
| **Verify** | Visits the site, confirms, optional photo | GPS within 200 m of the hazard; desk verification is refused |
| **Reject** | Dismisses with a written reason | Mandatory reason. Rejecting a **high-confidence (≥ 0.8) community hazard does not dismiss it**; it escalates to the parent agency for review |
| **Schedule** | Commits a fix date | Date required; shown publicly |
| **Resolve** | Uploads a geotagged after-photo on site | Photo + 200 m presence required; moves to closure check |

**SLA and escalation ladder** (`sla_policies`, `fn_housekeeping` every 5 min):

| Severity | Acknowledge | Resolve | Escalate every (overdue) |
|---|---|---|---|
| Critical | 24 h | 7 days | 72 h |
| Warning | 3 days | 30 days | 7 days |
| Info | 7 days | 90 days | 30 days |

`Gram Panchayat → Mandal Parishad → District Collector / District Road Safety Committee`. NH hazards go `NHAI PIU → Regional Office`. At the top of the ladder, overdue tickets are flagged on the public scorecard.

**Ownership routing** (`fn_resolve_owner`): nearest mapped road segment within 30 m → its `owner_agency_id`. Otherwise → the **smallest** agency geofence covering the point (usually the gram panchayat). Road ownership should be imported from OSM + PMGSY OMMAS + NHAI chainage data.

**Public accountability**: `v_agency_scorecard` lists each agency's open, overdue and open-critical tickets, median hours to resolve, and number of escalations. The same data feeds a weekly one-page PDF for gram sabha meetings, and a map export that can be cross-checked against iRAD/e-DAR.

**Tamper evidence**: `hazard_events` is append-only (UPDATE/DELETE raise exceptions). Each row stores `sha256(prev_hash | event)`, so any edit to history breaks the chain and is detectable.

---

## 3. Hazard taxonomy (the alert engine's vocabulary)

The taxonomy is **data** (`hazard_types`), so new types ship without an app release. Server and client copies: `db/002_taxonomy_seed.sql`, `edge/src/taxonomy.ts`.

| Code | Category | Default | Persistence (TTL) | Directional | Active | 2W/3W night/rain boost |
|---|---|---|---|---|---|---|
| `hairpin_bend` | Geometry | **critical** | permanent | ✓ | always | |
| `sharp_curve` | Geometry | warning | permanent | ✓ | always | |
| `blind_intersection` | Geometry | **critical** | permanent | | always | |
| `village_road_merge` | Geometry | warning | permanent | | always | |
| `unlit_dark_zone` *(stretch)* | Geometry | warning | permanent | | **night** | |
| `narrow_bridge_culvert` | Geometry | warning | permanent | | always | |
| `unprotected_edge_drop` *(stretch)* | Geometry | **critical** | permanent | | always | |
| `shoulder_edge_drop` | Geometry | warning | semi (90 d) | | always | ✓ |
| `missing_signage` | Geometry | info | semi | | *governance only, no rider alert* | |
| `speed_breaker_marked` | Calming | info | permanent | | always | |
| `speed_breaker_unmarked` | Calming | **critical** | permanent | | always | ✓ |
| `rumble_strips` | Calming | info | permanent | | always | |
| `unmarked_median_gap` | Conflict | warning | permanent | | always | |
| `wrong_side_hot_zone` *(stretch)* | Conflict | **critical** | recurring | | always | |
| `near_miss_hotspot` | Conflict (from hard-brake telemetry) | warning | semi (90 d) | | always | |
| `pothole` | Dynamic | warning | semi (30 d) | | always | ✓ |
| `crater_deep_pothole` | Dynamic | **critical** | semi (30 d) | | always | ✓ |
| `pothole_dense_stretch` *(stretch)* | Dynamic | warning | semi (60 d) | | always | ✓ |
| `stray_cattle_zone` | Dynamic | warning | recurring | | **dusk/dawn + night** | ✓ |
| `parked_heavy_vehicle` | Dynamic | **critical** | transient (12 h) | ✓ | **night** | |
| `waterlogging` | Dynamic | warning | transient (48 h) | | always | ✓ |
| `oil_spill_loose_gravel` | Dynamic | **critical** | transient (24 h) | | always | ✓ |
| `school_zone` | Dynamic | warning | recurring | | **school hours** | |
| `high_pedestrian_zone` | Dynamic | warning | permanent | | always | |
| `construction_diversion` | Dynamic | warning | transient (30 d) | | always | |
| `fog_prone_stretch` *(stretch)* | Dynamic | warning | recurring | | dusk/dawn | |

**Persistence drives behaviour:**
- *permanent*: no expiry; can become "familiar" (see §6.4).
- *semi*: decays over weeks unless reconfirmed.
- *transient*: expires in hours and is **never** downgraded for familiarity.
- *recurring*: a permanent pin whose alert is gated by time of day.

---

## 4. Geospatial database schema & spatial indexing

Files: `db/001_schema.sql` (tables, indexes, triggers, views), `db/003_functions.sql` (workflow + queries).

### 4.1 Entity overview

```
agencies (geofence MultiPolygon, parent_agency_id ─► escalation ladder)
   │ 1..n                        │ 1..n
   ▼                             ▼
road_segments (LineString)    app_users (role, reputation, attested, language)
   │                             │
   ▼                             ▼
road_hazards ◄──── hazard_reports (Tier 2 raw, client UUID = idempotency key)
 (Point + optional extent        hazard_votes   (PK hazard+user, voter_location)
  LineString, bearing, tier,     telemetry_events (Tier 3 raw, rotating pseudonym)
  confidence, status,
  sync_version, tile_gh5)
   │ 1..1                        │ 1..n
   ▼                             ▼
tickets (SLA clocks,         hazard_events (append-only, sha256 hash chain)
 escalation_level)
hazard_types / hazard_type_labels / sla_policies  (reference data)
```

### 4.2 Core table (excerpt)

```sql
CREATE TABLE road_hazards (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hazard_type        text NOT NULL REFERENCES hazard_types(code),
  location           geography(Point, 4326) NOT NULL,
  extent             geography(LineString, 4326),          -- stretches
  bearing_deg        smallint CHECK (bearing_deg BETWEEN 0 AND 359),
  severity           severity_level NOT NULL,
  status             hazard_status NOT NULL DEFAULT 'candidate',
  trust_tier         trust_tier NOT NULL,                  -- 1 | 2 | 3
  confidence         numeric(4,3) NOT NULL,
  owner_agency_id    uuid REFERENCES agencies(id),
  sync_version       bigint NOT NULL DEFAULT nextval('hazard_sync_seq'),
  tile_gh5           text GENERATED ALWAYS AS (ST_GeoHash(location::geometry, 5)) STORED,
  ...
);
CREATE INDEX road_hazards_location_gix ON road_hazards USING gist (location);
CREATE INDEX road_hazards_live_gix     ON road_hazards USING gist (location)
  WHERE status IN ('candidate','community_verified','authority_verified',
                   'work_scheduled','resolved_pending_check');          -- hot path
CREATE INDEX road_hazards_extent_gix   ON road_hazards USING gist (extent) WHERE extent IS NOT NULL;
CREATE INDEX road_hazards_tile_sync_idx ON road_hazards (tile_gh5, sync_version);   -- offline deltas
```

**Choices made:**
- **`GEOGRAPHY` for rider data**: distances come out in metres on the spheroid, everywhere in India, with no UTM zone switching between states.
- **EPSG:7755 (WGS 84 / India NSF LCC)** for DBSCAN clustering and buffering: one metric projection that covers the whole country.
- **Partial GIST index** on live statuses: closed and expired hazards (most rows, over time) never touch the hot path. Verified with `EXPLAIN`: `Index Scan using road_hazards_live_gix`.
- **Geohash-5 generated column** (~4.9 × 4.9 km): a cheap, deterministic tile key that phones compute identically (`edge/src/geo.ts → geohash`).
- **`sync_version` from a sequence**, bumped by trigger on every update: a total order for delta sync, with no reliance on clocks.
- At scale, partition `telemetry_events` by month (BRIN on `recorded_at` is already in place) and archive `hazard_events` yearly. Both are append-only.

### 4.3 Radius lookup (KNN-ordered)

```sql
-- fn_hazards_near(lat, lon, radius_m, min_confidence)
SELECT h.id, h.hazard_type, h.severity,
       ST_Distance(h.location, me.g)          AS distance_m,
       degrees(ST_Azimuth(me.g, h.location))  AS bearing_to_deg
  FROM safar.road_hazards h,
       (SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography AS g) me
 WHERE ST_DWithin(h.location, me.g, :radius_m)           -- GIST: bbox prefilter + exact test
   AND h.status IN ('candidate','community_verified','authority_verified',
                    'work_scheduled','resolved_pending_check')   -- matches partial index
   AND h.confidence >= :min_confidence
 ORDER BY h.location <-> me.g;                           -- KNN distance operator
```

### 4.4 Route-trajectory intersection (ordered along the route, direction-aware)

```sql
-- fn_hazards_along_route('LINESTRING(lon lat, ...)', corridor_m)
WITH r AS (SELECT ST_GeogFromText('SRID=4326;'||:wkt) g, ST_GeomFromText(:wkt,4326) geom,
                  ST_Length(ST_GeogFromText('SRID=4326;'||:wkt)) len_m),
hits AS (
  SELECT h.*, ht.directional,
         ST_LineLocatePoint(r.geom, h.location::geometry)  AS frac,      -- 0..1 along route
         ST_Distance(coalesce(h.extent, h.location), r.g)  AS lateral_m
    FROM safar.road_hazards h JOIN safar.hazard_types ht ON ht.code = h.hazard_type, r
   WHERE ST_DWithin(coalesce(h.extent, h.location), r.g, :corridor_m)   -- GIST corridor
     AND ht.rider_alert AND <live statuses>)
SELECT id, hazard_type, frac * len_m AS dist_along_m, lateral_m,
       -- route bearing at the hazard, from points 15 m either side of it
       degrees(ST_Azimuth(ST_LineInterpolatePoint(r.geom, frac - 15/len_m)::geography,
                          ST_LineInterpolatePoint(r.geom, frac + 15/len_m)::geography)) AS route_bearing,
       (NOT directional OR fn_bearing_diff(bearing_deg, route_bearing) <= 50)      AS applies
  FROM hits, r ORDER BY dist_along_m;
```

Tested: a truck pinned facing north returns `applies = true` for a northbound route and `false` for the same road southbound.

---

## 5. Offline-first edge architecture & resilience

Rural stretches have patchy 2G/4G. **Every alert decision happens on the phone.** The network is used only to refresh the cache and upload the outbox.

### 5.1 What gets cached (bounding-box prefetch)

| Layer | Coverage | When | Eviction |
|---|---|---|---|
| **Home region** | Geohash-5 tiles within 25 km of home/work (`tilesAround`) | On install, then nightly on Wi-Fi / charging | Pinned, never evicted |
| **Trip corridor** | `fn_tiles_for_route(route, 2000 m)`: tiles within 2 km of the planned route | When a trip starts with a destination (or a gig order is accepted) | 30 days after last use |
| **Rolling look-ahead** | Tiles within 10 km along current heading | While moving, whenever any connectivity exists | 30 days |

**Size estimate:** ~200 bytes per hazard row. A dense rural district with ~5,000 live hazards in a 25 km radius needs about **1 MB**, so all of India's live hazards would fit on a phone for a long time yet.

### 5.2 Local store (`edge/sql/edge_schema.sql`)

- `hazards` + `hazards_rtree` (SQLite R*Tree on lat/lon boxes; stretches index their extent's bbox). Triggers keep them in sync. Fallback `gh7` index if R*Tree is missing. Bundle `requery/sqlite-android` or SpatiaLite so R*Tree/JSON1 don't depend on the OEM's SQLite build.
- `tiles` (gh5, last_sync_version, pinned)
- `outbox` (client UUID, kind, payload, attempts, next_attempt): **idempotent**. The server's `fn_submit_report` returns the same hazard for a replayed UUID.
- `familiarity`, `alert_log`: local only, never uploaded.
- WAL mode, so the 1 Hz alert reader never blocks the sync writer.

Hot-path query (1 Hz):

```sql
SELECT h.* FROM hazards_rtree r JOIN hazards h ON h.rid = r.rid
 WHERE r.min_lat <= :lat + :dlat AND r.max_lat >= :lat - :dlat
   AND r.min_lon <= :lon + :dlon AND r.max_lon >= :lon - :dlon
   AND (h.expires_at_ms IS NULL OR h.expires_at_ms > :now_ms);
-- then exact haversine / cone / route checks in CoPilotEngine
```

### 5.3 Sync protocol

```
Phone                                              Server
  │  POST /sync {tiles:[{gh5, since_version}]}         │
  │ ─────────────────────────────────────────────────► │ fn_sync_delta(tiles, min(since))
  │ ◄───────────────────────────────────────────────── │ rows ordered by sync_version (≤5,000/page)
  │  upsert where incoming.sync_version > local        │   tombstone=true → DELETE locally
  │  advance tiles.last_sync_version                   │
  │                                                    │
  │  POST /outbox [ {id:uuid, kind, payload}, ... ]    │ replay: fn_submit_report / fn_cast_vote /
  │ ─────────────────────────────────────────────────► │         fn_record_pass / telemetry insert
  │ ◄── per-item ack (or permanent error) ─────────────│ (idempotent on uuid)
  │  delete acked; retry others with backoff           │
  │  (WorkManager: network constraint, 30 s → 6 h)     │
```

**Conflict rules:**
- The server is authoritative for hazards.
- The rider's own unsynced report is inserted locally with `local_only = 1`, so it alerts immediately, including for other people sharing that phone. It is replaced by the server row on the next sync.
- Votes are last-write-wins per (hazard, user).
- Transient hazards carry `expires_at` and expire on the phone even if it never syncs again.

### 5.4 Battery and data budget

- GPS at 1 Hz while moving (fused provider), 0.2 Hz when stationary for > 2 min.
- Accelerometer at 50 Hz **only above 12 km/h and when the phone is mounted** (gravity vector stable).
- Telemetry leaves the phone as **events (~60 bytes)**, never raw traces. A typical 2-hour gig shift uploads < 20 KB.

---

## 6. Co-pilot alert engine & anti-notification-fatigue UX

Code: `edge/src/alertEngine.ts` (pure logic, no I/O; 14 scenario tests).

### 6.1 Velocity-based lookahead

```
stopping  = v·t_react + v² / (2·a_decel)          t_react: 1.3 s (2.0 s novice)
                                                  a_decel: 2W 3.5 · 3W 3.0 · car 4.5 · bus 3.0 · truck 2.5 m/s²
                                                  × 0.7 when raining
lead      = v · T_lead(severity)                  T_lead: critical 7 s · warning 5 s · info 3.5 s (+1.5 s novice)
lookahead = clamp( max(1.25·stopping + 15, lead), min(severity), 500 m )
fire when distance ≤ lookahead + v·1 s            (one GPS interval + audio latency)
```

Measured in simulation (unmarked speed breaker, two-wheeler, dry):

| Speed | Mode | First cue at | Time to hazard | Spoken (rounded **down**) |
|---|---|---|---|---|
| 40 km/h | standard | 78 m | 7 s | "ముందు స్పీడ్ బ్రేకర్, 70 మీటర్లు" |
| 60 km/h | standard | 133 m | 8 s | "… 100 మీటర్లు" |
| 80 km/h | standard | 156 m | 7 s | "… 150 మీటర్లు" |
| 60 km/h | novice | 150 m | 9 s | "… 150 మీటర్లు" |

Spoken distances are always rounded **down**, so a hazard never sounds farther away than it is.

### 6.2 Relevance: "is this ahead of *me*?"

1. **Route mode** (when the route is known: our own navigation, or a gig partner SDK): project the rider and hazard onto the route polyline, then use *along-route* distance and lateral offset ≤ 25 m. This sees hazards **around bends** that a straight-line cone misses (tested).
2. **Cone mode** (no route): the hazard must lie within ±20° of heading above 40 km/h (±30° above 18 km/h, ±45° below), widened by GPS accuracy, with lateral offset ≤ 20 m. This rejects hazards on parallel roads and behind the rider.
3. **Direction filter**: directional hazards (hairpin, parked truck) apply only if travel heading is within 50° of the pinned bearing.
4. **Time gating**: night, dusk/dawn, school hours, rain.
5. **Severity adjustment**:
   - Two-wheelers and three-wheelers at night or in rain: one level **up** for surface hazards.
   - `resolved_pending_check`: one level **down** (still alerts).
   - Tier-3 or confidence < 0.5: spoken as "Possible …" and capped at *warning*.

### 6.3 Multi-modal cue vocabulary

Every level has to be recognizable **without looking at the phone**.

| Level | Haptic (Android waveform ms) | Earcon | Voice | Visual (OLED night theme) |
|---|---|---|---|---|
| **Critical** | `400·120·400·120·600` (three long) | rising 3-tone 880→1568 Hz | always | full-screen red `#FF3B30` edge flash |
| **Urgent repeat** (critical ignored, TTH ≤ 3 s, not slowing) | rapid 5-pulse | fast repeat | one word: "నెమ్మదిగా" / "धीरे करें" / "Slow down" | red flash |
| **Warning** | `180·140·180` (two short) | double 660 Hz | yes (subject to spacing) | amber `#FFB300` banner |
| **Info** | `60` (one tick) | soft 440 Hz | novice mode only | cyan `#4FC3F7` chip |
| **Rough stretch start / end** | rapid triple / light double | distinct pair | "Rough road, for the next 300 m" | amber band on the map edge |

- **Directional audio**: the cue is stereo-panned by the hazard's relative bearing (`pan` −1…+1), only when GPS accuracy ≤ 25 m. This needs earphones or a helmet intercom. Phone speakers are mono.
- **Voice**: **human-recorded clips** per language (`hazard_type_labels.voice_clip`, Opus), composed as `[label] + [distance]`. They work offline and sound natural. On-device TTS is the fallback for new types. v1 languages are **Telugu, Tamil, Hindi and English**; add Kannada, Marathi, Bengali, Odia by recording about 40 clips each.
- **Night mode**: true-black OLED background, no white surfaces, hazard colours only. Brightness is capped so the screen doesn't ruin the rider's night vision.
- **HUD mode** (cars, autos, trucks): a horizontally mirrored, high-contrast single-hazard view for windshield reflection. It shows hazard icon + distance + direction arrow only.

### 6.4 Anti-fatigue rules (and the rules that override them)

| Rule | Behaviour | Never applies to |
|---|---|---|
| **One cue per hazard per approach** | Re-alerts only if severity escalates or after a 10-min cooldown + 300 m away | — |
| **Grouping** | ≥ 3 surface defects within 400 m → **one** "rough road for the next X m" cue, then a soft end cue | Critical craters inside the cluster still cue individually |
| **Voice spacing** | ≤ 1 spoken prompt per 4 s. Lower-priority cues keep earcon + haptic | Critical always speaks |
| **Familiarity** | After ≥ 5 safe passes (slowed, no jolt, ≥ 80% safe), voice drops; earcon + haptic remain | Novice mode, transient/obstacle/people hazards, wrong-side zones |
| **Low-speed mute** | Below 8 km/h (jam, walking the bike) nothing fires | — |
| **Info is quiet** | Info-level is earcon/haptic only unless in novice mode | — |
| **Urgent repeat** | Fires once if a critical cue was ignored (speed ≥ 85% of alert speed, TTH ≤ 3 s) | Not fired if the rider slowed |
| **Max 3 cues per tick** | Critical first, then nearest | — |
| **Attention budget** | All non-critical spoken prompts (warnings, stretches, speed nudges) share **4 per 5 minutes**; over budget they keep earcon + haptic only | Critical always speaks |
| **Calm screen** | Nothing on screen between alerts. The bubble fades in for a cue and out after 4–12 s; only critical cues pulse or flash the edges; the notification never changes per cue | — |

**Pass detection** feeds two loops. Every pass of a hazard (closest approach ≤ 30 m, then moving away) records whether the rider **slowed** and whether the JoltDetector registered a **jolt** there:
- **Locally**, it updates familiarity.
- **For hazards in `resolved_pending_check`**, it is uploaded anonymously as a pass report (`fn_record_pass`). This is how physics verifies the agency's "fixed".

### 6.5 Speed coach: the one place humour is allowed

Over-speeding is the cause recorded for most crash deaths, but a nagging speed alarm gets switched off. So the speed coach (`android/core/.../SpeedCoach.kt`) is built to be **rare, friendly and never in the way**.

| Rule | Behaviour |
|---|---|
| Hazards first | No nudge within 8 s of a hazard cue, or while any warning/critical hazard ahead is still unannounced |
| Sustained only | Over (comfort limit × 1.10 + 5 km/h) for 8 s (4 s inside a zone). An overtake is not a nag |
| Rare | ≥ 4 min apart, ≤ 3 per 30 min, and nudges count against the shared voice budget |
| Respect the rider | 3 ignored in a row → 20 min silence, then ≤ 1 per 30 min until they ease off once |
| Zones are serious | In a school / pedestrian / cattle / dark-stretch zone the line is plain ("பள்ளி குழந்தைகள் கடக்கும் இடம், மெதுவாக"), never a joke |
| Praise is rarer | After easing off: "சூப்பர்! இது தான் மாஸ்!", at most once per 30 min, fun mode only |

**Comfort limits** (not legal limits): two-wheeler 60, auto 50, car 80, bus 70, truck 60 km/h, minus 10 at night and 10 in rain (floor 30). Zone limits: school 25, pedestrian or pothole stretch 30, cattle / village junction / wrong-side / fog 40, dark stretch 50. The rider can set their own limit.

**Fun mode** (on by default, one switch to turn off) uses original street-banter lines in Tamil, Telugu, Hindi and English, e.g. *"பிரியாணி ஆறாது பாஸ், பொறுமையா போங்க!"* for delivery partners, or *"ஹீரோ என்ட்ரி படத்துல மட்டும் தான்… ரோட்டுல வேணாம்!"*.
- There are no film dialogues or actors' catchphrases.
- The joke is always on the speed, never on the rider.
- A shuffle-bag plays every line once before any repeats.
- The nudge tone is a soft falling two-note that sounds nothing like a hazard alert.

### 6.6 Tier-3 sensing: `edge/src/joltDetector.ts` (8 tests)

```
accel (50 Hz, incl. gravity) ─► low-pass → gravity vector ĝ (τ≈1 s) ─► a_v = a·ĝ − |g|  (works at any mount angle)
                                   │
                                   └─► ĝ swings >20° in 1 s → phone in hand → suppress 2 s
trigger |a_v| > 0.30 g + 0.004 g/kmh·speed  (speed ≥ 12 km/h)
burst until quiet (≤0.12 g for 150 ms) → classify:
   pushed UP first and ≥1.5 m long (duration × speed)  → hump (unmarked speed breaker)
   DROP first, or short sharp hit                       → pothole   (crater if normalised peak ≥ 1.2 g)
1 s refractory: front + rear wheel = one event
Hard brake: GPS speed decel ≥ 0.4 g sustained ≥ 1 s from ≥ 20 km/h → near-miss telemetry
```

Tested on synthetic traces with engine vibration at mount angles of 0°, 35°, 60° and 85°. Tested for: no false events on smooth road, pothole vs hump classification, one event per pothole for two wheels, two separate potholes counted, silence below 12 km/h, and phone pickup rejection. **Thresholds must be recalibrated on real rides** (see §9).

---

## 7. Gig-worker companion mode & first-time travellers

### 7.1 Ride alongside the apps they already use

Gig workers will not switch navigation apps; their earnings depend on Rapido, Uber, Ola, Swiggy and Zomato. So the product is a **companion layer**:

- **Floating bubble overlay** (Android `SYSTEM_ALERT_WINDOW`) on top of the partner app's map. A ~56 dp circle that shows the next hazard icon and distance, and turns red with a pulse for critical. The rider never has to touch it.
- **Foreground service** with a persistent notification (required by Android for background location). One tap toggles "On duty / Off duty".
- **Partner SDK (v2)**: aggregators pass the active route (`EngineConfig.route`) to unlock route mode, and receive hazard feeds for their fleet. Gig fleets are also the densest Tier-3 sensor network available, since thousands of phones pass every arterial daily.
- **Borrow what works** in ride-hailing UX: map-dominant screens, a bottom sheet with one primary action, large tap targets (≥ 56 dp), high-contrast state colours, and instant feedback. **Don't borrow** the attention-seeking parts: no popups that require dismissal, no earnings nudges while moving.

### 7.2 Reporting without touching the phone

| Context | Input |
|---|---|
| Moving | **Voice**: "గుంత" / "pothole" / "स्पीड ब्रेकर" (on-device keyword spotting, ~20 words). Or **earphone/headset button double-press**: drops a "something here" pin for later classification |
| Stopped (speed < 3 km/h for 5 s) | Big-icon grid of 8 most common types, then optional photo. Two taps max |
| After the trip | "You passed 3 unverified hazards today: still there?" yes/no cards (proof of presence is satisfied from the trip's GPS trace stored only on the device) |

### 7.3 First-time on a road (novice mode)

- **Pre-ride briefing**: before a new route, read out the critical hazards along it, e.g. "This route has 2 sharp bends near Kalahasti and an unmarked speed breaker after the bridge."
- Novice mode adds 0.7 s of reaction time and 1.5 s of extra lead, speaks info-level hazards, and **never** downgrades for familiarity.
- Novice mode switches on automatically for any route with < 2 prior trips, and can be locked on for new riders or learners.

---

## 8. Safety, privacy & legal guardrails

1. **Don't create false confidence.** Onboarding and the settings screen state plainly: *"No alert does not mean the road is safe. Most hazards are not mapped yet."* Coverage is shown as a shaded map, so riders can see where the app knows little.
2. **Zero-touch while moving.** No interaction is ever required at speed. Handheld phone use while driving is an offence under the Motor Vehicles Act; the app is designed for a mounted phone and hands-free use only.
3. **DPDP Act 2023 compliance**:
   - Explicit, separate consent for (a) alerts, (b) contributing reports, (c) passive telemetry.
   - Phone numbers are stored only as salted hashes.
   - Telemetry uses a **weekly rotating pseudonym**, and trips are never uploaded, only events.
   - **Privacy zones**: events within 300 m of saved home/work are dropped on the device.
   - Users can delete their reports and votes; hazards persist with the attribution removed.
4. **Photos**: an on-device face and number-plate blur runs before upload. Officer photos are kept as evidence; rider photos are optional.
5. **No blame engine.** The platform maps *road conditions*, not people. There are no features for reporting individual drivers or vehicles.
6. **Officer accountability cuts both ways.** Agencies see their scorecard before it is public, and get a 30-day onboarding grace period, so the system comes across as a tool and not a public shaming machine. That framing is what makes panchayats adopt it.

---

## 9. Pilot plan & how we will know it works

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Calibrate** (4 weeks) | 20 riders, 3 vehicle types, 2 mount types, one mandal. Ground-truth survey of ~200 humps/potholes | Jolt detector precision ≥ 0.8 / recall ≥ 0.6 per pass; Tier-3 cluster precision ≥ 0.9 |
| **1. Pilot mandal** (3 months) | 1 mandal parishad + its gram panchayats onboarded; 300–500 riders incl. local gig partners | ≥ 70% of critical tickets acknowledged within SLA; alert "useful" rating ≥ 80%; < 1 cue per km median |
| **2. District** (6–12 months) | District collectorate, PWD, NHAI PIU | Median time-to-fix trend; reopen rate; coverage map |
| **3. Impact study** | Compare crash/injury counts (iRAD/e-DAR + hospital data) on treated stretches vs. matched control stretches, before and after | Honest outcome measure. Crash reductions take a year or more to show statistically |

**Metrics to track from day one:**
- Cues per km and per hour (fatigue).
- Fraction of critical cues followed by slowing (effectiveness).
- False-alarm reports ("not there" votes).
- Hazard verification latency.
- Time-to-fix by agency.
- Reopen rate (fixes that didn't hold).

---

## 10. What is built and tested vs. what is next

### Built and tested in this repository

| Component | Files | Verification |
|---|---|---|
| PostGIS schema, taxonomy, SLA | `db/001…003` | Loaded on PostgreSQL 16 + PostGIS 3 |
| Trust model, consensus, geofenced officer workflow, closure-by-physics, telemetry clustering, escalation, expiry, hash-chained audit, route/radius queries, tile sync | `db/003_functions.sql` | `db/tests/workflow_test.sql`: **16-step end-to-end scenario, all assertions pass**; `EXPLAIN` confirms partial GIST index use |
| Offline SQLite cache with R*Tree | `edge/sql/edge_schema.sql` | Loaded and queried in SQLite (point + stretch bbox, delete cascade to R*Tree) |
| Alert engine | `edge/src/alertEngine.ts` | `edge/test/engine.test.ts`: **14 scenario tests** |
| Jolt + hard-brake detectors | `edge/src/joltDetector.ts` | `edge/test/jolt.test.ts`: **8 tests** on synthetic sensor traces |
| Geo utilities incl. geohash matching PostGIS | `edge/src/geo.ts` | Exercised by all edge tests; strict `tsc` clean |
| Phone ⇄ server contract (exactly-once outbox, paged tile sync) | `db/004_api.sql` | `db/tests/api_test.sql`: **6 steps pass** on PostGIS |
| Kotlin core (engine, speed coach, detectors, tone synth, sun-based night/dusk, 4-language taxonomy, geo) | `android/core/` | **40 JUnit tests pass** (Kotlin 2.0.21); TS engine scenarios plus speed coach, Tamil coverage and voice budget |
| Android shell (location FGS, overlay bubble + edge flash, haptics/tones/TTS with ducking, SQLite cache, WorkManager sync, Compose UI, te/hi/en strings) | `android/app/` | Written for SDK 35 / AGP 8.7. **Not yet built**: the Android SDK was unavailable where it was written. First Android Studio build may need small fixes |

**Design-only so far (specified above, not yet coded):**
- Voice/headset-button reporting and the pre-ride briefing (§7).
- Privacy zones, photo blurring and consent screens (§8).
- The HTTP wrapper around `004_api.sql` and the officer console.
- Reputation updates.

### Next (in suggested order)

1. **First Android Studio build + field calibration** of the Kotlin app (`android/README_ANDROID.md` has the checklist).
2. **HTTP API** (FastAPI or Go): two endpoints that call `fn_apply_outbox_item` / `fn_sync_page`, plus phone-OTP auth and officer accounts provisioned by the district.
3. **Reputation updates**: raise reporter reputation when hazards they reported are verified, lower it when dismissed. The hook is `fn_recompute`'s status transitions.
4. **Road ownership import**: OSM + PMGSY OMMAS + NHAI chainage into `road_segments.owner_agency_id`; LGD codes for panchayat boundaries.
5. **Officer web console** + weekly gram-sabha PDF from `v_agency_scorecard`.
6. **Crash detection → 112 hand-off** (v2, separate safety review): high-g impact + stillness + no response to a prompt within 30 s → share location with chosen contacts / ERSS 112. This needs very low false-positive rates and careful legal review before it ships.
7. **iRAD/e-DAR alignment**: export verified hazards in a form the district road safety committee can overlay on official crash data.

---

### Sources

- MoRTH, *Road Accidents in India 2023* (Aug 2025): via [DT Next / PTI](https://www.dtnext.in/news/national/172-lakh-people-died-in-480-lakh-road-accidents-in-2023-road-ministry-report-844831), [Vikaspedia summary](https://en.vikaspedia.in/viewcontent/social-welfare/social-awareness/consumer-education/safe-driving/road-accidents-in-india?lgn=en)
- 2024 fatalities, Parliament reply: [The Week / PTI](https://www.theweek.in/wire-updates/business/2025/12/05/dcm19-lsq-road-accidents-gadkari.html)
- Young men 15–29 (SRS): [Data for India](https://www.dataforindia.com/road-accident-deaths/)
- World Bank / SaveLIFE (2021): [Traffic Crash Injuries and Disabilities](https://www.worldbank.org/en/country/india/publication/traffic-crash-injuries-and-disabilities-the-burden-on-indian-society)
- Under-reporting: [IndiaSpend](https://www.indiaspend.com/data-gaps/with-single-data-source-india-tends-to-underreport-road-crash-deaths-781261)
- Potholes and Safe System framing: [CAG](https://www.cag.org.in/blogs/black-spots-safe-systems)
- IJMR 2026 Trauma Dashboard viewpoint: [ijmr.org.in](https://ijmr.org.in/real-time-public-display-dashboards-reframing-road-traffic-accidents-in-india/)
- MoRTH black-spot definition: [SOP circular](https://morth.gov.in/sites/default/files/comprehensive_compendium_circular/5100.20-9.11.2020%20Guidelines%20SOP%20for%20monitorig.pdf)
- iRAD / e-DAR: [IIT Madras CoERS](https://coers.iitm.ac.in/irad/)
