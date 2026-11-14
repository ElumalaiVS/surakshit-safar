import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JoltDetector, HardBrakeDetector, type AccelSample, type JoltEvent,
         type HardBrakeEvent } from '../src/joltDetector.ts';

const G = 9.80665;

/** Deterministic PRNG so tests are repeatable. */
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5; };
}

/**
 * Synthesize a 50 Hz accelerometer trace for a phone mounted at `tiltDeg` (portrait on a
 * handlebar, leaning back). `vertical(tS)` is the true vertical dynamic accel in g.
 * Engine vibration noise is added on all axes.
 */
function trace(durationS: number, vertical: (t: number) => number, tiltDeg = 60, noise = 0.06, seed = 7): AccelSample[] {
  const r = rng(seed);
  const th = (tiltDeg * Math.PI) / 180;
  const up = [0, Math.sin(th), Math.cos(th)];   // device-frame "up" direction
  const out: AccelSample[] = [];
  for (let i = 0; i < durationS * 50; i++) {
    const t = i / 50;
    const a = (1 + vertical(t)) * G;              // gravity reaction + bump
    out.push({
      tMs: 1000 + i * 20,
      ax: up[0] * a + r() * noise * G * 2,
      ay: up[1] * a + r() * noise * G * 2,
      az: up[2] * a + r() * noise * G * 2,
    });
  }
  return out;
}

function run(samples: AccelSample[], speedKmh: number, det = new JoltDetector()): JoltEvent[] {
  const ev: JoltEvent[] = [];
  for (const s of samples) { const e = det.push(s, speedKmh); if (e) ev.push(e); }
  return ev;
}

// Pothole at 40 km/h: wheel drops (-0.7 g, 60 ms) then slams the far edge (+1.5 g, 40 ms)
const pothole = (t0: number) => (t: number) => {
  const d = t - t0;
  if (d >= 0 && d < 0.06) return -0.7;
  if (d >= 0.06 && d < 0.10) return 1.5;
  if (d >= 0.10 && d < 0.16) return -0.3;
  return 0;
};
// Hump at 25 km/h: pushed up for 300 ms, then down for 250 ms (~3.8 m long)
const hump = (t0: number) => (t: number) => {
  const d = t - t0;
  if (d >= 0 && d < 0.30) return 0.7 * Math.sin((Math.PI * d) / 0.30);
  if (d >= 0.30 && d < 0.55) return -0.5 * Math.sin((Math.PI * (d - 0.30)) / 0.25);
  return 0;
};

test('smooth road with engine vibration produces no events', () => {
  assert.equal(run(trace(20, () => 0, 60, 0.08), 50).length, 0);
});

test('pothole detected and classified regardless of mount angle', () => {
  for (const tilt of [0, 35, 60, 85]) {
    const ev = run(trace(6, pothole(3), tilt), 40);
    assert.equal(ev.length, 1, `tilt ${tilt}: ${JSON.stringify(ev)}`);
    assert.equal(ev[0].kind, 'vertical_jolt_pothole', `tilt ${tilt}`);
    assert.ok(ev[0].rawPeakG > 1.2, `peak ${ev[0].rawPeakG}`);
  }
});

test('speed breaker detected as a hump', () => {
  const ev = run(trace(6, hump(3)), 25);
  assert.equal(ev.length, 1, JSON.stringify(ev));
  assert.equal(ev[0].kind, 'vertical_jolt_hump');
  assert.ok(ev[0].spatialLenM >= 1.5, `length ${ev[0].spatialLenM} m`);
});

test('front + rear wheel over the same pothole = one event (refractory)', () => {
  const twoWheels = (t: number) => pothole(3)(t) || pothole(3.12)(t);
  assert.equal(run(trace(6, twoWheels), 40).length, 1);
});

test('two separate potholes 3 s apart = two events', () => {
  const two = (t: number) => pothole(2)(t) || pothole(5)(t);
  assert.equal(run(trace(8, two), 40).length, 2);
});

test('below 12 km/h nothing is reported (stopping, kerbs, parking)', () => {
  assert.equal(run(trace(6, pothole(3)), 8).length, 0);
});

test('phone picked up mid-ride: rotation suppresses false jolts', () => {
  // gravity swings from 60 deg to 10 deg tilt over 0.4 s with a hand bump, then stays
  const samples: AccelSample[] = [];
  const r = rng(3);
  for (let i = 0; i < 300; i++) {
    const t = i / 50;
    const tilt = t < 2 ? 60 : t < 2.4 ? 60 - (t - 2) * 125 : 10;
    const th = (tilt * Math.PI) / 180;
    const bump = t > 2.1 && t < 2.2 ? 0.9 : 0;
    const a = (1 + bump) * G;
    samples.push({ tMs: 1000 + i * 20, ax: r() * 0.5, ay: Math.sin(th) * a + r() * 0.5, az: Math.cos(th) * a + r() * 0.5 });
  }
  assert.equal(run(samples, 30).length, 0);
});

test('hard brake: 60 -> 15 km/h in 3 s is flagged; gentle stop is not', () => {
  const hb = new HardBrakeDetector();
  const ev: HardBrakeEvent[] = [];
  const speeds = [60, 60, 60, 45, 30, 15, 15];            // 15 km/h per s = 0.42 g, sustained 3 s
  speeds.forEach((k, i) => { const e = hb.push(i * 1000, k / 3.6); if (e) ev.push(e); });
  assert.equal(ev.length, 1);
  assert.ok(ev[0].decelG >= 0.38, `decel ${ev[0].decelG}`);

  const gentle = new HardBrakeDetector();
  const g: unknown[] = [];
  [60, 55, 50, 45, 40, 35, 30, 25, 20].forEach((k, i) => { const e = gentle.push(i * 1000, k / 3.6); if (e) g.push(e); });
  assert.equal(g.length, 0);
});
