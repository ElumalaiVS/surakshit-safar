# Surakshit Safar — Android app (Kotlin)

A companion co-pilot that runs **on top of** Rapido / Uber / Ola / Swiggy / Google Maps. It warns riders about hazards ahead using a brief bubble, an edge flash (critical only), a vibration pattern, a synthesized tone, and a voice prompt in **Telugu, Tamil, Hindi or English**. Over-speeding gets a rare, friendly nudge, with optional fun lines. It works fully offline once the area is cached.

**Calm by default.**
- The screen shows nothing between alerts.
- Non-critical voice prompts are capped at 4 per 5 minutes.
- Speed nudges give way to hazard warnings and back off if ignored.
- Critical hazards are never silenced.

```
android/
├── core/        Pure Kotlin/JVM: no Android imports. All safety logic lives here.
│   ├── CoPilotEngine.kt      lookahead, relevance, anti-fatigue, voice budget, cues
│   ├── SpeedCoach.kt         over-speed nudges: comfort/zone limits, caps, back-off, fun lines
│   ├── Detectors.kt          JoltDetector (pothole/hump), HardBrakeDetector
│   ├── EarconSynth.kt        tones rendered to stereo PCM (no audio assets)
│   ├── RideContextProvider.kt night / dusk from sun elevation, school hours, rain
│   ├── Taxonomy.kt, Geo.kt, Models.kt
│   └── src/test/…            40 JUnit tests
└── app/         Android shell
    ├── service/CoPilotService.kt   location FGS: GPS + accelerometer -> engine -> cues -> outbox
    ├── cues/CueRenderer.kt         VibrationEffect waveforms, AudioTrack tones, TTS, audio ducking
    ├── overlay/HazardOverlay.kt    draggable bubble + red edge flash over other apps
    ├── data/HazardDb.kt            SQLite cache (hazards, tiles, outbox, familiarity)
    ├── data/CachedHazardStore.kt   2.5 km in-memory working set for the 1 Hz loop
    ├── data/Reporter.kt, Prefs.kt  outbox payloads, settings, weekly pseudonym
    ├── sync/SyncWorker.kt          WorkManager: upload outbox, pull tile deltas, evict
    └── ui/MainActivity.kt          Compose: duty toggle, settings, stopped-only reporting
```

## Build & run

Requirements: Android Studio Ladybug (2024.2) or newer, JDK 17+, Android SDK 35.

1. **File → Open** the `android/` folder. Studio downloads Gradle 8.14.3, AGP 8.7.3 and the dependencies.
2. Run the core tests: `./gradlew :core:test` (or the green arrows in `core/src/test`).
3. Run `app` on a phone (recommended) or an emulator.
4. On first launch:
   - Tap **Off duty** → allow location (and notifications on Android 13+).
   - Tap **Allow** on the overlay notice → enable "Display over other apps".
   - Tap **Play a sample alert** to hear and feel a critical cue, and set the volume.
5. Telugu / Tamil voice: needs that voice in **Settings → System → Languages → Text-to-speech** (Speech Services by Google → install Telugu or Tamil). If it is missing, the app tells you and falls back to English. It never reads Tamil or Telugu text with an English voice.

**API URL:** `app/build.gradle.kts → API_BASE_URL`. Debug builds point at `http://10.0.2.2:8000`, the host machine as seen from the emulator.

**Without a server**, everything except sync still works:
- Reports go into the outbox and show up locally at once.
- Alerts work for anything in the local DB.
- To test alerts with no server, insert rows with `HazardDb.applyServerRows(...)` from a debug screen.

## How a ride flows

```
FusedLocation 1 Hz ──┐                         ┌─► CueRenderer: vibrate → tone (panned) → speech
                     ├─► "copilot" HandlerThread ─► CoPilotEngine.update(fix, context)
Accelerometer 50 Hz ─┘   (single thread,        │        ▲ CachedHazardStore ◄─ SQLite
 (only >12 km/h,          no locks needed)       ├─► HazardOverlay: bubble / edge flash (main thread)
  only with consent)                             ├─► familiarity → SQLite
                                                 └─► outbox: pass reports, telemetry (privacy-filtered)
                                                              │
                                    SyncWorker (network) ◄────┘  upload + tile deltas
```

### Design points

- **One engine thread.** Location callbacks, sensor callbacks and the engine all run on one `HandlerThread`, so the engine never needs locks.
- **Clocks.** Sensor timestamps (elapsed-realtime nanoseconds) are converted to wall-clock time, so jolts line up with GPS fixes and hazard expiry times.
- **Jolt position.** A jolt is placed by dead-reckoning from the last fix (up to 1 s old), so a pothole hit at 40 km/h isn't recorded 11 m back.
- **Battery:**
  - GPS drops to 0.2 Hz after 2 minutes stationary.
  - The accelerometer runs only above 12 km/h, and only with consent.
  - The 1 Hz loop reads from memory, not disk.
- **Audio.** Uses `USAGE_ASSISTANCE_NAVIGATION_GUIDANCE` with transient, duckable focus, so the rider's music and the gig app's own voice dip rather than stop. The tone always finishes before speech starts.
- **Overlay:**
  - The bubble never takes focus.
  - The edge flash is `FLAG_NOT_TOUCHABLE` with window alpha 0.8. Above 0.8, Android 12+ blocks touches to the app underneath, which would break Rapido or Uber.
- **Zero-touch while moving.** The report buttons only enable after 5 s stopped with GPS accuracy ≤ 30 m.
- **Privacy:**
  - Telemetry is opt-in (a separate switch).
  - It is dropped within 300 m of home and when GPS accuracy is over 20 m.
  - It carries a pseudonym that rotates weekly.
  - Trips are never uploaded.
- **Not sticky.** The service is not restarted by the system. A background restart couldn't get "while in use" location anyway, and we deliberately don't request background location.

## Server API contract

The SQL side is implemented and tested in `db/004_api.sql` (`db/tests/api_test.sql`). The HTTP layer only authenticates, resolves the user, and calls these functions.

### `POST /v1/outbox`

```json
{ "items": [ { "id": "uuid", "kind": "report|vote|pass|telemetry", "payload": { … } } ] }
→ { "acked": ["uuid", …], "rejected": ["uuid", …] }
```

Per item: `SELECT safar.fn_apply_outbox_item(id, kind, payload, user_id)`.
- Processing is **exactly-once per id**: replays return the earlier outcome.
- `rejected` = a permanent problem; the phone deletes the item.
- On server errors, return HTTP 5xx; the phone backs off (30 s → 6 h) and retries.

| kind | payload (built in `Reporter.kt`) | Server call |
|---|---|---|
| `report` | `hazard_type, lat, lon, heading_deg, speed_kmh, accuracy_m, reported_at, note` | `fn_submit_report` (item id = report id) |
| `vote` | `hazard_id, vote (confirm/deny/fixed), lat, lon` | `fn_cast_vote` |
| `pass` | `hazard_id, jolted` | `fn_record_pass` |
| `telemetry` | `kind, lat, lon, heading_deg, speed_kmh, peak_g, duration_ms, vehicle_class, recorded_at, device_pseudonym` | insert `telemetry_events` |

Reports and votes need a signed-in user (phone OTP → bearer token). Pass reports and telemetry are anonymous.

### `POST /v1/sync`

```json
{ "tiles": [ { "gh5": "tf2mr", "since": 1234 } ], "limit": 5000 }
→ { "rows": [ { "hazard_id", "hazard_type", "lat", "lon", "extent_geojson", "bearing_deg",
                "severity", "status", "trust_tier", "confidence", "expires_at",
                "tile_gh5", "sync_version", "tombstone" } ],
    "has_more": false }
```

The server answers with `SELECT safar.fn_sync_page(tiles, limit)`.
- The phone advances each tile to the highest `sync_version` it received, and repeats while `has_more` is true.
- `tombstone: true` → the phone deletes that hazard.

## What is verified vs. not

| Part | Status |
|---|---|
| `core/` (engine, speed coach, detectors, synth, sun/context, taxonomy, geo) | **Compiled with Kotlin 2.0.21 and 40 tests pass.** TS engine scenarios plus speed nudges, Tamil coverage and voice budget; geohashes match PostGIS byte-for-byte |
| Server contract (`004_api.sql`) | **Tested on PostgreSQL 16 + PostGIS 3**: idempotent replays, rejections, paged sync, tombstones |
| `app/` (Android shell) | Written against current Android APIs (SDK 35, AGP 8.7). **Not yet built.** Gradle and the Android SDK couldn't be downloaded in the environment where this was written. A Kotlin compile pass against `core` found no syntax errors and no mismatches with the core API. **Expect a short round of compile fixes on the first Android Studio build** |

## Field-test checklist (before any public release)

- [ ] **Mounts.** Handlebar mount, dashboard mount, and phone in pocket (pocket should produce *no* jolt events, because handling detection suppresses them).
- [ ] **Jolt calibration.** 20 rides over 30 known humps and potholes: log `JoltEvent`s next to ground truth, then tune `JoltConfig` thresholds per vehicle class.
- [ ] **Cue audibility.** At 40, 60 and 80 km/h on a scooter: phone speaker, single earphone, and Bluetooth helmet. Haptics on a handlebar mount are often masked by engine vibration.
- [ ] **Overlay.** Check it over Rapido, Uber, Ola, Swiggy, Zomato and Google Maps, and confirm none of them block or hide it.
- [ ] **OEM battery killers.** Xiaomi/Redmi, Realme, Oppo and Vivo kill foreground services aggressively. Add an onboarding step pointing riders to "No restrictions" / autostart for the app.
- [ ] **Battery.** 4-hour duty shift battery drain, target < 8% over Maps alone.
- [ ] **TTS.** Telugu, Tamil and Hindi prompts reviewed by native speakers. Check Google TTS pronunciation of "స్పీడ్ బ్రేకర్" and "வேகத்தடை", and check that the fun lines land as friendly, not rude, with real riders in Chennai and Tirupati.
- [ ] **Nudge rate.** Over a week of real gig shifts, confirm the median rider hears < 1 speed nudge per hour, and track how many switch fun mode off.
