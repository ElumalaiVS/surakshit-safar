// =============================================================================
//  Tier-3 passive telemetry: detect potholes, unmarked humps and hard braking
//  from phone sensors, orientation-independent (phone can be mounted at any angle).
//
//  Pipeline (50 Hz accelerometer, TYPE_ACCELEROMETER incl. gravity, m/s^2):
//    1. Low-pass -> gravity vector g (tau ~1 s). Its direction = "down" for this mount.
//    2. Vertical dynamic accel  a_v = dot(a, g_hat) - |g|   (positive = pushed up)
//    3. Reject handling: if g_hat swings >15 deg within ~1 s the phone is in a hand.
//    4. Trigger when |a_v| > threshold(speed); gather the burst until quiet.
//    5. Classify by first-lobe sign and spatial length (duration x speed):
//         hump    : pushed UP first, >= 1.5 m long   (IRC humps are ~3.7 m wide)
//         pothole : DROP first, or a short sharp hit  (< 1.5 m)
//  Only events (not raw traces) leave the phone: privacy + bandwidth.
// =============================================================================

export interface AccelSample { tMs: number; ax: number; ay: number; az: number; }

export type JoltKind = 'vertical_jolt_pothole' | 'vertical_jolt_hump';

export interface JoltEvent {
  kind: JoltKind;
  tMs: number;             // event start
  peakG: number;           // speed-normalised magnitude (comparable across speeds)
  rawPeakG: number;
  durationMs: number;
  spatialLenM: number;
  speedKmh: number;
}

const G = 9.80665;

export interface JoltConfig {
  minSpeedKmh: number;      // below this, bumps are the rider's own doing (stopping, kerbs)
  baseThresholdG: number;
  perKmhG: number;
  quietG: number;
  quietMs: number;
  maxEventMs: number;
  refractoryMs: number;     // front + rear wheel of the same pothole = one event
  handlingDeg: number;
}

export const DEFAULT_JOLT_CONFIG: JoltConfig = {
  minSpeedKmh: 12,
  baseThresholdG: 0.30,
  perKmhG: 0.004,
  quietG: 0.12,
  quietMs: 150,
  maxEventMs: 1500,
  refractoryMs: 1000,
  handlingDeg: 20,          // hard braking tilts the gravity estimate ~10-14 deg; a hand swings it more
};

export class JoltDetector {
  private g: [number, number, number] | null = null;
  private gHistory: { tMs: number; u: [number, number, number] }[] = [];
  private handlingUntilMs = 0;
  private refractoryUntilMs = 0;
  private burst: { tMs: number; v: number }[] | null = null;
  private lastLoudMs = 0;
  private lastTMs = 0;
  private cfg: JoltConfig;

  constructor(cfg: JoltConfig = DEFAULT_JOLT_CONFIG) { this.cfg = cfg; }

  /** Feed one accelerometer sample with the latest GPS speed. Returns an event when one completes. */
  push(s: AccelSample, speedKmh: number): JoltEvent | null {
    const dt = this.lastTMs ? Math.max(1, s.tMs - this.lastTMs) : 20;
    this.lastTMs = s.tMs;

    // 1. gravity estimate (time-constant ~1 s regardless of sample rate)
    const alpha = Math.min(1, dt / 1000);
    if (!this.g) this.g = [s.ax, s.ay, s.az];
    else {
      this.g[0] += alpha * (s.ax - this.g[0]);
      this.g[1] += alpha * (s.ay - this.g[1]);
      this.g[2] += alpha * (s.az - this.g[2]);
    }
    const gn = Math.hypot(this.g[0], this.g[1], this.g[2]) || G;
    const u: [number, number, number] = [this.g[0] / gn, this.g[1] / gn, this.g[2] / gn];

    // 3. handling detection: compare gravity direction with ~1 s ago
    this.gHistory.push({ tMs: s.tMs, u });
    while (this.gHistory.length && s.tMs - this.gHistory[0].tMs > 1000) this.gHistory.shift();
    const old = this.gHistory[0].u;
    const cos = Math.max(-1, Math.min(1, old[0] * u[0] + old[1] * u[1] + old[2] * u[2]));
    if ((Math.acos(cos) * 180) / Math.PI > this.cfg.handlingDeg) {
      this.handlingUntilMs = s.tMs + 2000;
      this.burst = null;
    }

    // 2. vertical dynamic acceleration in g
    const vG = (s.ax * u[0] + s.ay * u[1] + s.az * u[2] - gn) / G;

    if (s.tMs < this.handlingUntilMs || speedKmh < this.cfg.minSpeedKmh) {
      this.burst = null;
      return null;
    }

    const thr = this.cfg.baseThresholdG + this.cfg.perKmhG * speedKmh;

    // 4. burst capture
    if (!this.burst) {
      if (s.tMs >= this.refractoryUntilMs && Math.abs(vG) > thr) {
        this.burst = [{ tMs: s.tMs, v: vG }];
        this.lastLoudMs = s.tMs;
      }
      return null;
    }
    this.burst.push({ tMs: s.tMs, v: vG });
    if (Math.abs(vG) > this.cfg.quietG) this.lastLoudMs = s.tMs;

    const quietLongEnough = s.tMs - this.lastLoudMs >= this.cfg.quietMs;
    const tooLong = s.tMs - this.burst[0].tMs >= this.cfg.maxEventMs;
    if (!quietLongEnough && !tooLong) return null;

    const ev = this.classify(this.burst, speedKmh, thr);
    this.burst = null;
    this.refractoryUntilMs = s.tMs + this.cfg.refractoryMs;
    return ev;
  }

  private classify(b: { tMs: number; v: number }[], speedKmh: number, thr: number): JoltEvent | null {
    // first lobe: the earliest sample with real energy (half threshold), looking a bit before trigger
    const half = thr * 0.5;
    const first = b.find(p => Math.abs(p.v) > half) ?? b[0];
    const firstSign = Math.sign(first.v);
    const lastActive = [...b].reverse().find(p => Math.abs(p.v) > half) ?? b[b.length - 1];
    const durationMs = Math.max(20, lastActive.tMs - first.tMs);
    const spatialLenM = (durationMs / 1000) * (speedKmh / 3.6);
    const rawPeakG = Math.max(...b.map(p => Math.abs(p.v)));
    // speed normalisation: impulse grows roughly with sqrt(speed) for the same defect
    const peakG = rawPeakG * Math.sqrt(30 / Math.max(speedKmh, 15));

    const kind: JoltKind = firstSign > 0 && spatialLenM >= 1.5 ? 'vertical_jolt_hump' : 'vertical_jolt_pothole';
    return {
      kind, tMs: first.tMs,
      peakG: Math.round(peakG * 1000) / 1000,
      rawPeakG: Math.round(rawPeakG * 1000) / 1000,
      durationMs, spatialLenM: Math.round(spatialLenM * 100) / 100,
      speedKmh,
    };
  }
}

// ------------------------------------------------------------------ hard braking
export interface HardBrakeEvent { tMs: number; decelG: number; fromKmh: number; toKmh: number; }

/** Hard braking from GPS Doppler speed: sustained decel >= 0.4 g for >= 1 s from >= 20 km/h. */
export class HardBrakeDetector {
  private series: { tMs: number; v: number }[] = [];
  private cooldownUntil = 0;
  private thresholdG: number;
  private minSustainMs: number;
  private minFromKmh: number;

  constructor(thresholdG = 0.4, minSustainMs = 1000, minFromKmh = 20) {
    this.thresholdG = thresholdG;
    this.minSustainMs = minSustainMs;
    this.minFromKmh = minFromKmh;
  }

  push(tMs: number, speedMps: number): HardBrakeEvent | null {
    this.series.push({ tMs, v: speedMps });
    while (this.series.length && tMs - this.series[0].tMs > 4000) this.series.shift();
    if (tMs < this.cooldownUntil || this.series.length < 2) return null;

    // walk back over the contiguous decelerating window ending now
    let i = this.series.length - 1;
    while (i > 0) {
      const a = this.series[i - 1], b = this.series[i];
      const dec = (a.v - b.v) / ((b.tMs - a.tMs) / 1000);
      if (dec / 9.80665 < this.thresholdG) break;
      i--;
    }
    const start = this.series[i], end = this.series[this.series.length - 1];
    const span = end.tMs - start.tMs;
    if (span >= this.minSustainMs && start.v * 3.6 >= this.minFromKmh) {
      this.cooldownUntil = tMs + 5000;
      const decelG = (start.v - end.v) / (span / 1000) / 9.80665;
      return { tMs: start.tMs, decelG: Math.round(decelG * 100) / 100,
               fromKmh: Math.round(start.v * 3.6), toKmh: Math.round(end.v * 3.6) };
    }
    return null;
  }
}
