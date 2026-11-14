// Run: node --test test/   (Node 22.18+ runs TypeScript directly)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoPilotEngine, MemoryHazardStore, type Hazard, type RideContext, type EngineConfig,
         type Cue, type PassEvent } from '../src/alertEngine.ts';
import { destination, type LatLon } from '../src/geo.ts';

const ORIGIN: LatLon = { lat: 13.6100, lon: 79.4100 };
const DAY: RideContext   = { night: false, duskDawn: false, schoolHours: false, raining: false };
const NIGHT: RideContext = { night: true,  duskDawn: false, schoolHours: false, raining: false };

/** Point `north` metres north and `east` metres east of ORIGIN. */
function at(north: number, east = 0): LatLon {
  return destination(destination(ORIGIN, 0, north), 90, east);
}

function hz(id: string, type: string, p: LatLon, over: Partial<Hazard> = {}): Hazard {
  return { id, type, lat: p.lat, lon: p.lon, severity: 'warning', status: 'community_verified',
           trustTier: 2, confidence: 0.85, ...over };
}

interface Step { north: number; east?: number; speedKmh: number; heading: number; }

/** Drive a path, 1 fix per second; returns every cue with the rider position when it fired. */
function drive(engine: CoPilotEngine, steps: Step[], ctx: RideContext = DAY, t0 = 1_000_000) {
  const cues: (Cue & { atNorth: number; atEast: number })[] = [];
  const passes: PassEvent[] = [];
  steps.forEach((s, i) => {
    const p = at(s.north, s.east ?? 0);
    const r = engine.update({ lat: p.lat, lon: p.lon, speedMps: s.speedKmh / 3.6, headingDeg: s.heading,
                              accuracyM: 5, tMs: t0 + i * 1000 }, ctx);
    for (const c of r.cues) cues.push({ ...c, atNorth: s.north, atEast: s.east ?? 0 });
    passes.push(...r.passes);
  });
  return { cues, passes };
}

/** Straight run north at constant speed from `from` to `to` metres. */
function straight(from: number, to: number, speedKmh: number): Step[] {
  const out: Step[] = [];
  const step = speedKmh / 3.6;
  for (let n = from; n <= to; n += step) out.push({ north: n, speedKmh, heading: 0 });
  return out;
}

const cfg = (o: Partial<EngineConfig> = {}): EngineConfig =>
  ({ vehicle: '2w', mode: 'standard', lang: 'en', ...o });

// ---------------------------------------------------------------------------------
test('lookahead grows with speed, novice mode and rain', () => {
  const e = new CoPilotEngine(new MemoryHazardStore([]), cfg());
  const at30 = e.lookahead(30 / 3.6, 'critical', false);
  const at60 = e.lookahead(60 / 3.6, 'critical', false);
  const at80 = e.lookahead(80 / 3.6, 'critical', false);
  assert.ok(at30 < at60 && at60 < at80, `${at30} < ${at60} < ${at80}`);
  assert.ok(at60 >= 110 && at60 <= 125, `60 km/h critical lookahead ~117 m, got ${at60}`);
  const wet = e.lookahead(60 / 3.6, 'warning', true);
  const dry = e.lookahead(60 / 3.6, 'warning', false);
  assert.ok(wet > dry, 'wet roads need more distance');
  const novice = new CoPilotEngine(new MemoryHazardStore([]), cfg({ mode: 'novice' }));
  assert.ok(novice.lookahead(60 / 3.6, 'critical', false) > at60, 'novice riders get earlier warnings');
});

test('unmarked speed breaker at 60 km/h: one timely critical cue with voice, haptic and flash', () => {
  const store = new MemoryHazardStore([hz('sb1', 'speed_breaker_unmarked', at(800), { severity: 'critical' })]);
  const e = new CoPilotEngine(store, cfg({ lang: 'te' }));
  const { cues } = drive(e, straight(0, 1000, 60));
  const approach = cues.filter(c => c.hazardId === 'sb1' && c.kind === 'approach');
  assert.equal(approach.length, 1, 'exactly one approach cue');
  const c = approach[0];
  assert.equal(c.level, 'critical');
  assert.ok(c.timeToHazardS >= 6, `>= 6 s warning, got ${c.timeToHazardS}`);
  assert.ok(c.timeToHazardS <= 9 && c.distanceM <= 140, `not absurdly early, got ${c.distanceM} m`);
  assert.match(c.speech ?? '', /స్పీడ్ బ్రేకర్/);
  assert.equal(c.visual.flash, true);
  assert.equal(c.haptic.length, 6);
});

test('hazards behind, beside or on a parallel road are ignored', () => {
  const store = new MemoryHazardStore([
    hz('behind', 'pothole', at(-50)),
    hz('side',   'pothole', at(300, 120)),      // 120 m east: different road
  ]);
  const e = new CoPilotEngine(store, cfg());
  const { cues } = drive(e, straight(0, 500, 50));
  assert.equal(cues.length, 0, JSON.stringify(cues.map(c => c.hazardId)));
});

test('directional + time-gated: parked truck only for traffic facing it, only at night', () => {
  const store = new MemoryHazardStore([
    hz('truckN', 'parked_heavy_vehicle', at(400, 3), { severity: 'critical', bearingDeg: 0 }),
    hz('truckS', 'parked_heavy_vehicle', at(600, -3), { severity: 'critical', bearingDeg: 180 }),
  ]);
  const night = drive(new CoPilotEngine(store, cfg()), straight(0, 800, 50), NIGHT).cues;
  assert.deepEqual([...new Set(night.map(c => c.hazardId))], ['truckN']);
  const day = drive(new CoPilotEngine(store, cfg()), straight(0, 800, 50), DAY).cues;
  assert.equal(day.length, 0, 'night-only hazard silent in daylight');
});

test('urgent repeat only when the rider ignores a critical cue', () => {
  const store = new MemoryHazardStore([hz('crater', 'crater_deep_pothole', at(500), { severity: 'critical' })]);
  const ignoring = drive(new CoPilotEngine(store, cfg()), straight(0, 600, 60)).cues;
  assert.ok(ignoring.some(c => c.kind === 'urgent_repeat'), 'ignoring rider gets urgent cue');

  // Rider who brakes after the first cue: 60 -> 25 km/h
  const e = new CoPilotEngine(store, cfg());
  let n = 0, v = 60, alerted = false;
  const t0 = 2_000_000;
  const cues: Cue[] = [];
  for (let i = 0; i < 80 && n < 600; i++) {
    const p = at(n);
    const r = e.update({ lat: p.lat, lon: p.lon, speedMps: v / 3.6, headingDeg: 0, accuracyM: 5, tMs: t0 + i * 1000 }, DAY);
    cues.push(...r.cues);
    if (r.cues.some(c => c.kind === 'approach')) alerted = true;
    if (alerted) v = Math.max(25, v - 12);
    n += v / 3.6;
  }
  assert.ok(cues.some(c => c.kind === 'approach'));
  assert.ok(!cues.some(c => c.kind === 'urgent_repeat'), 'no nagging when the rider slows');
});

test('familiar hazard on a daily commute: voice drops after 5 safe passes, haptic stays; novice keeps voice', () => {
  const store = new MemoryHazardStore([hz('sb', 'speed_breaker_unmarked', at(300), { severity: 'critical' })]);
  const e = new CoPilotEngine(store, cfg());
  const commute = (): Step[] => {
    const s: Step[] = [];
    for (let n = 0; n <= 200; n += 13.9) s.push({ north: n, speedKmh: 50, heading: 0 });
    for (let n = 205; n <= 320; n += 4) s.push({ north: n, speedKmh: 15, heading: 0 });  // slows for the hump
    for (let n = 330; n <= 600; n += 13.9) s.push({ north: n, speedKmh: 50, heading: 0 });
    return s;
  };
  let day = 0;
  const run = () => drive(e, commute(), DAY, 10_000_000 + day++ * 86_400_000);
  for (let i = 0; i < 5; i++) {
    const r = run();
    assert.ok(r.cues[0].speech, `day ${i + 1} spoken`);
    assert.equal(r.passes.length, 1);
    assert.equal(r.passes[0].slowed, true);
  }
  const sixth = run().cues[0];
  assert.equal(sixth.speech, null, 'familiar: no voice');
  assert.ok(sixth.haptic.length > 0 && sixth.earcon, 'familiar: still earcon + haptic');

  const novice = new CoPilotEngine(store, cfg({ mode: 'novice' }));
  novice.loadFamiliarity([{ hazardId: 'sb', safe: 50, rough: 0 }]);
  assert.ok(drive(novice, straight(0, 400, 50)).cues[0].speech, 'novice mode never silences voice');
});

test('pothole cluster becomes ONE rough-stretch cue, then a soft end cue', () => {
  const potholes = [400, 450, 520, 590, 650].map((n, i) => hz(`p${i}`, 'pothole', at(n)));
  const e = new CoPilotEngine(new MemoryHazardStore(potholes), cfg());
  const { cues } = drive(e, straight(0, 800, 40));
  const kinds = cues.map(c => c.kind);
  assert.deepEqual(kinds, ['stretch_start', 'stretch_end'], kinds.join(','));
  assert.match(cues[0].speech ?? '', /Rough road, for the next/);
});

test('crater inside a pothole cluster still gets its own critical cue', () => {
  const list = [400, 450, 520, 590].map((n, i) => hz(`p${i}`, 'pothole', at(n)));
  list.push(hz('crater', 'crater_deep_pothole', at(560), { severity: 'critical' }));
  const { cues } = drive(new CoPilotEngine(new MemoryHazardStore(list), cfg()), straight(0, 800, 40));
  assert.ok(cues.some(c => c.kind === 'stretch_start'));
  assert.ok(cues.some(c => c.hazardId === 'crater' && c.level === 'critical'));
});

test('low speed (traffic jam / walking) is silent', () => {
  const store = new MemoryHazardStore([hz('p', 'pothole', at(30))]);
  const { cues } = drive(new CoPilotEngine(store, cfg()), straight(0, 60, 5));
  assert.equal(cues.length, 0);
});

test('telemetry-only candidate is spoken as "possible" and capped at warning', () => {
  const store = new MemoryHazardStore([hz('t3', 'speed_breaker_unmarked', at(400),
    { severity: 'critical', trustTier: 3, status: 'candidate', confidence: 0.45 })]);
  const { cues } = drive(new CoPilotEngine(store, cfg()), straight(0, 500, 50));
  assert.equal(cues.length, 1);
  assert.equal(cues[0].level, 'warning');
  assert.equal(cues[0].tentative, true);
  assert.match(cues[0].speech ?? '', /^Possible /);
});

test('two-wheeler at night: pothole boosted to critical; a car is not', () => {
  const store = new MemoryHazardStore([hz('p', 'pothole', at(400))]);
  const bike = drive(new CoPilotEngine(store, cfg({ vehicle: '2w' })), straight(0, 500, 50), NIGHT).cues;
  const car  = drive(new CoPilotEngine(store, cfg({ vehicle: 'car' })), straight(0, 500, 50), NIGHT).cues;
  assert.equal(bike[0].level, 'critical');
  assert.equal(car[0].level, 'warning');
});

test('voice spacing: back-to-back warnings keep haptics but only one is spoken', () => {
  const store = new MemoryHazardStore([
    hz('a', 'unmarked_median_gap', at(400)),
    hz('b', 'village_road_merge', at(425)),
  ]);
  const { cues } = drive(new CoPilotEngine(store, cfg()), straight(0, 500, 60));
  assert.equal(cues.length, 2);
  assert.equal(cues.filter(c => c.speech).length, 1);
  assert.ok(cues.every(c => c.haptic.length > 0));
});

test('route mode sees a hazard just around a bend; heading cone alone cannot', () => {
  const corner = at(300);
  const route: LatLon[] = [at(0), corner, at(300, 400)];
  const store = new MemoryHazardStore([hz('bend', 'blind_intersection', at(300, 60), { severity: 'critical' })]);
  const steps: Step[] = [];
  for (let n = 0; n <= 300; n += 11.1) steps.push({ north: n, speedKmh: 40, heading: 0 });

  const withRoute = drive(new CoPilotEngine(store, cfg({ route })), steps).cues;
  assert.equal(withRoute.length, 1, 'route mode warns before the corner');
  assert.ok(withRoute[0].atNorth < 300 && withRoute[0].atNorth >= 230, `fired at ${withRoute[0].atNorth}`);

  const coneOnly = drive(new CoPilotEngine(store, cfg()), steps).cues;
  assert.equal(coneOnly.length, 0, 'cone mode cannot see around the corner');
});

test('pass events report jolts for the closure check', () => {
  const store = new MemoryHazardStore([hz('fixed?', 'pothole', at(300), { status: 'resolved_pending_check' })]);
  const e = new CoPilotEngine(store, cfg());
  const p = at(300);
  e.noteJolt(1_000_000 + 21_000, p.lat, p.lon);    // rider hit it ~21 s into the ride
  const { passes } = drive(e, straight(0, 500, 50));
  assert.equal(passes.length, 1);
  assert.equal(passes[0].jolted, true);
  assert.equal(passes[0].status, 'resolved_pending_check');
});
