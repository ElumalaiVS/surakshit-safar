// =============================================================================
//  CoPilotEngine: on-device, offline hazard alerting.
//
//  Called once per GPS fix (~1 Hz). Pure logic: no I/O, no timers. The Android/iOS
//  shell feeds it fixes + context and plays the cues it returns (TTS/voice clips,
//  earcons, haptics, screen flash). That keeps it unit-testable and portable
//  (React Native, Kotlin Multiplatform port, or a gig-app SDK).
//
//  Design goals
//    1. Warn early enough to stop:  lookahead grows with speed (stopping distance).
//    2. Only what is ahead of *me*: heading cone or route corridor + direction filter.
//    3. Never cry wolf:            familiarity, grouping, voice spacing, low-speed mute.
//    4. Never go silent on danger: critical cues bypass fatigue rules; urgent repeat
//                                  if the rider has not slowed.
// =============================================================================

import {
  type LatLon, haversine, bearing, bearingDiff, relativeBearing, distanceToPolyline,
} from './geo.ts';
import {
  TAXONOMY, type HazardMeta, type Severity, type Lang, HAPTIC, EARCON, UNITS, speakDistance,
} from './taxonomy.ts';

// ---------------------------------------------------------------------------- types
export interface Hazard {
  id: string;
  type: string;
  lat: number;
  lon: number;
  extent?: LatLon[] | null;          // stretches
  bearingDeg?: number | null;        // directional hazards
  severity: Severity;
  status: string;                    // server hazard_status
  trustTier: 1 | 2 | 3;
  confidence: number;
  expiresAtMs?: number | null;
}

export interface HazardStore {
  /** Live hazards whose bbox intersects the circle (R*Tree query in production). */
  query(center: LatLon, radiusM: number, nowMs: number): Hazard[];
}

export interface Fix {
  lat: number;
  lon: number;
  speedMps: number;
  headingDeg: number | null;         // GPS course; null/unstable at low speed
  accuracyM: number;
  tMs: number;
}

export interface RideContext {
  night: boolean;
  duskDawn: boolean;
  schoolHours: boolean;
  raining: boolean;
}

export type VehicleClass = '2w' | '3w' | 'car' | 'bus' | 'truck';
export type RiderMode = 'novice' | 'standard' | 'gig';

export interface EngineConfig {
  vehicle: VehicleClass;
  mode: RiderMode;
  lang: Lang;
  route?: LatLon[] | null;           // planned route if known (nav mode / gig SDK)
}

export type CueKind = 'approach' | 'urgent_repeat' | 'stretch_start' | 'stretch_end';

export interface Cue {
  hazardId: string;
  hazardType: string;
  level: Severity;
  kind: CueKind;
  distanceM: number;
  timeToHazardS: number;
  speech: string | null;             // null = earcon/haptic only
  earcon: string | null;
  haptic: number[];
  pan: number;                       // -1 left … +1 right (stereo/directional audio)
  visual: { color: string; flash: boolean };
  tentative: boolean;                // Tier-3 / low confidence: spoken as "possible …"
}

export interface PassEvent {
  hazardId: string;
  hazardType: string;
  status: string;
  slowed: boolean;
  jolted: boolean;
  tMs: number;
}

export interface UpdateResult { cues: Cue[]; passes: PassEvent[]; lookaheadM: number; }

interface HazardState {
  alertedLevel: Severity | null;
  alertedAtMs: number;
  speedAtAlertMps: number;
  urgentSent: boolean;
  minDist: number;
  speedAtMinDist: number;
  lastDist: number;
  passedAtMs: number | null;
  coveredByStretch: boolean;
}

interface Familiarity { safe: number; rough: number; }

// ---------------------------------------------------------------------- constants
const LEVEL_RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };
const RANK_LEVEL: Severity[] = ['info', 'warning', 'critical'];

const LEAD_TIME_S: Record<Severity, number> = { critical: 7, warning: 5, info: 3.5 };
const MIN_LOOKAHEAD_M: Record<Severity, number> = { critical: 60, warning: 40, info: 25 };
const MAX_LOOKAHEAD_M = 500;
const DECEL_MPS2: Record<VehicleClass, number> = { '2w': 3.5, '3w': 3.0, car: 4.5, bus: 3.0, truck: 2.5 };

const LOW_SPEED_MUTE_MPS = 8 / 3.6;      // walking pace / jam: stay quiet
const VOICE_GAP_MS = 4000;               // min spacing between spoken prompts
const COOLDOWN_MS = 10 * 60 * 1000;      // don't re-alert a hazard you just passed
const URGENT_TTH_S = 3.0;
const LATENCY_S = 1.0;                   // GPS fix interval + audio start: fire one tick early                // urgent repeat when this close and not slowing
const PASS_RADIUS_M = 30;
const STRETCH_GROUP_MIN = 3;             // >=3 surface defects …
const STRETCH_GROUP_WINDOW_M = 400;      // … within 400 m become one "rough stretch" cue
const FAMILIAR_SAFE_PASSES = 5;

const COLORS: Record<Severity, string> = { critical: '#FF3B30', warning: '#FFB300', info: '#4FC3F7' };

const URGENT_WORD: Record<Lang, string> = { en: 'Slow down', te: 'నెమ్మదిగా', hi: 'धीरे करें' };
const POSSIBLE: Record<Lang, string> = { en: 'Possible ', te: 'బహుశా ', hi: 'संभवतः ' };
const ROUGH_STRETCH: Record<Lang, string> = { en: 'Rough road', te: 'గుంతల దారి', hi: 'खराब सड़क' };

// ========================================================================= engine
export class CoPilotEngine {
  private states = new Map<string, HazardState>();
  private familiarity = new Map<string, Familiarity>();
  private jolts: { tMs: number; lat: number; lon: number }[] = [];
  private lastVoiceMs = -Infinity;
  private lastHeading: number | null = null;
  private lastFix: Fix | null = null;
  private stretch: { ids: Set<string> } | null = null;
  private store: HazardStore;
  private cfg: EngineConfig;

  constructor(store: HazardStore, cfg: EngineConfig) {
    this.store = store;
    this.cfg = cfg;
  }

  setConfig(cfg: Partial<EngineConfig>): void { this.cfg = { ...this.cfg, ...cfg }; }

  /** Load persisted familiarity (from SQLite `familiarity` table) at start-up. */
  loadFamiliarity(rows: { hazardId: string; safe: number; rough: number }[]): void {
    for (const r of rows) this.familiarity.set(r.hazardId, { safe: r.safe, rough: r.rough });
  }
  getFamiliarity(id: string): Familiarity | undefined { return this.familiarity.get(id); }

  /** Feed from JoltDetector so pass events know whether the rider hit the hazard. */
  noteJolt(tMs: number, lat: number, lon: number): void {
    this.jolts.push({ tMs, lat, lon });
    if (this.jolts.length > 50) this.jolts.shift();
  }

  // ------------------------------------------------------------------ lookahead
  /** Distance at which a hazard of this severity must be announced, metres. */
  lookahead(speedMps: number, sev: Severity, raining: boolean): number {
    const novice = this.cfg.mode === 'novice';
    const reaction = novice ? 2.0 : 1.3;                              // perception-reaction, s
    const decel = DECEL_MPS2[this.cfg.vehicle] * (raining ? 0.7 : 1);   // wet roads
    const stopping = speedMps * reaction + (speedMps * speedMps) / (2 * decel);
    const lead = (LEAD_TIME_S[sev] + (novice ? 1.5 : 0)) * speedMps;
    const d = Math.max(stopping * 1.25 + 15, lead, MIN_LOOKAHEAD_M[sev]);
    return Math.min(d, MAX_LOOKAHEAD_M);
  }

  // --------------------------------------------------------------------- update
  update(fix: Fix, ctx: RideContext): UpdateResult {
    const cues: Cue[] = [];
    const passes: PassEvent[] = [];
    const v = Math.max(0, fix.speedMps);
    const heading = this.resolveHeading(fix);
    const here: LatLon = { lat: fix.lat, lon: fix.lon };
    const maxLook = this.lookahead(v, 'critical', ctx.raining);
    const queryR = Math.max(maxLook, STRETCH_GROUP_WINDOW_M) + fix.accuracyM + 50;

    const hazards = this.store.query(here, queryR, fix.tMs)
      .filter(h => !h.expiresAtMs || h.expiresAtMs > fix.tMs);

    // --- 1. geometry: which hazards are ahead of me, how far, which side
    type Cand = { h: Hazard; meta: HazardMeta; d: number; rel: number; inside: boolean; level: Severity; tentative: boolean };
    const ahead: Cand[] = [];
    for (const h of hazards) {
      const meta = TAXONOMY[h.type];
      if (!meta || !meta.riderAlert) continue;
      let st = this.state(h.id);
      const geo = this.relate(here, heading, fix.accuracyM, h, meta, v);

      // Re-arm: cooldown over and we are well away, or we abandoned the approach (turned off)
      if ((st.passedAtMs !== null && fix.tMs - st.passedAtMs >= COOLDOWN_MS && geo.d > 300) ||
          (st.passedAtMs === null && st.alertedLevel !== null && geo.d > st.minDist + 500)) {
        this.states.delete(h.id);
        st = this.state(h.id);
      }

      // pass detection runs for every tracked hazard, alerted or not
      if (geo.d < st.minDist) { st.minDist = geo.d; st.speedAtMinDist = v; }
      if (st.passedAtMs === null && st.minDist <= PASS_RADIUS_M && geo.d > st.minDist + 8 && geo.d > st.lastDist) {
        passes.push(this.completePass(h, st, fix));
      }
      st.lastDist = geo.d;

      if (!geo.ahead || heading === null) continue;
      if (!this.isActive(meta, ctx)) continue;
      if (st.passedAtMs !== null && fix.tMs - st.passedAtMs < COOLDOWN_MS) continue;

      const { level, tentative } = this.effectiveLevel(h, meta, ctx);
      if (tentative && level === 'info' && this.cfg.mode !== 'novice') continue;
      ahead.push({ h, meta, d: geo.d, rel: geo.rel, inside: geo.inside, level, tentative });
    }

    // --- 2. low-speed mute: in a jam or walking the bike, nothing is actionable
    if (v < LOW_SPEED_MUTE_MPS) {
      this.prune(here);
      this.lastFix = fix;
      return { cues, passes, lookaheadM: maxLook };
    }

    // --- 3. grouping: many potholes close together -> one "rough road" stretch cue
    const stretchCue = this.maybeStretch(ahead.filter(c => c.meta.family === 'surface' && c.level !== 'critical'
                                                       && !c.meta.isStretch), v, fix, ctx.raining);
    if (stretchCue) cues.push(stretchCue);

    // --- 4. per-hazard approach / urgent cues, nearest-in-time first
    ahead.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || a.d - b.d);
    for (const c of ahead) {
      const st = this.state(c.h.id);
      if (st.coveredByStretch) continue;
      const look = this.lookahead(v, c.level, ctx.raining);
      const tth = v > 0.5 ? c.d / v : Infinity;

      if (st.alertedLevel === null || LEVEL_RANK[c.level] > LEVEL_RANK[st.alertedLevel]) {
        if (c.d <= look + v * LATENCY_S || c.inside) {
          cues.push(this.buildCue(c.h, c.meta, c.level, 'approach', c.d, tth, c.rel, fix, c.tentative));
          st.alertedLevel = c.level;
          st.alertedAtMs = fix.tMs;
          st.speedAtAlertMps = v;
        }
      } else if (c.level === 'critical' && !st.urgentSent && tth <= URGENT_TTH_S
                 && v >= 0.85 * st.speedAtAlertMps && v > 5) {
        // Rider was warned but has not slowed: escalate once, short and sharp.
        cues.push(this.buildCue(c.h, c.meta, 'critical', 'urgent_repeat', c.d, tth, c.rel, fix, c.tentative));
        st.urgentSent = true;
      }
    }

    // --- 5. stretch end
    if (this.stretch && [...this.stretch.ids].every(id => this.state(id).passedAtMs !== null)) {
      cues.push({
        hazardId: 'stretch', hazardType: 'pothole_dense_stretch', level: 'info', kind: 'stretch_end',
        distanceM: 0, timeToHazardS: 0, speech: null, earcon: null, haptic: HAPTIC.stretch_end,
        pan: 0, visual: { color: COLORS.info, flash: false }, tentative: false,
      });
      this.stretch = null;
    }

    this.applyVoicePolicy(cues, fix.tMs);
    this.prune(here);
    this.lastFix = fix;
    return { cues: cues.slice(0, 3), passes, lookaheadM: maxLook };
  }

  // ---------------------------------------------------------------- internals
  private state(id: string): HazardState {
    let s = this.states.get(id);
    if (!s) {
      s = { alertedLevel: null, alertedAtMs: 0, speedAtAlertMps: 0, urgentSent: false,
            minDist: Infinity, speedAtMinDist: 0, lastDist: Infinity, passedAtMs: null,
            coveredByStretch: false };
      this.states.set(id, s);
    }
    return s;
  }

  /** GPS course is junk below ~5 km/h; fall back to last good heading or movement vector. */
  private resolveHeading(fix: Fix): number | null {
    if (fix.headingDeg !== null && fix.speedMps >= 1.5) {
      this.lastHeading = fix.headingDeg;
    } else if (this.lastFix && haversine(this.lastFix, fix) > 5) {
      this.lastHeading = bearing(this.lastFix, fix);
    }
    return this.lastHeading;
  }

  /** Is hazard h ahead of the rider? Returns distance, relative bearing, inside-stretch. */
  private relate(here: LatLon, heading: number | null, acc: number, h: Hazard, meta: HazardMeta, v: number):
      { ahead: boolean; d: number; rel: number; inside: boolean } {
    // Stretch hazards: distance to their polyline; inside if we are on it.
    let target: LatLon = { lat: h.lat, lon: h.lon };
    let d: number;
    let inside = false;
    if (h.extent && h.extent.length >= 2) {
      const p = distanceToPolyline(here, h.extent);
      d = p.distance;
      inside = d <= 25 + acc * 0.5;
      // aim at the nearer end so "ahead" works when approaching the stretch
      const a = h.extent[0], b = h.extent[h.extent.length - 1];
      target = haversine(here, a) <= haversine(here, b) ? a : b;
      if (!inside) d = Math.min(haversine(here, a), haversine(here, b));
    } else {
      d = haversine(here, target);
    }
    if (heading === null) return { ahead: false, d, rel: 0, inside };

    // Direction filter: e.g. a hairpin pinned for downhill traffic, a truck on the left shoulder
    if (meta.directional && h.bearingDeg != null && bearingDiff(heading, h.bearingDeg) > 50) {
      return { ahead: false, d, rel: 0, inside: false };
    }
    if (inside) return { ahead: true, d: 0, rel: 0, inside };

    // Route mode: distance along the planned route beats a straight-line cone on curvy roads.
    const route = this.cfg.route;
    if (route && route.length >= 2) {
      const me = distanceToPolyline(here, route);
      if (me.distance <= 50) {
        const hz = distanceToPolyline(target, route);
        const along = hz.alongM - me.alongM;
        const ahead = hz.distance <= 25 + acc * 0.5 && along > 0;
        const rel = relativeBearing(heading, bearing(here, target));
        return { ahead, d: ahead ? along : d, rel, inside: false };
      }
      // off-route (detour): fall through to cone mode
    }

    // Cone mode: narrower at speed (you are on a road, not in an open field)
    const rel = relativeBearing(heading, bearing(here, target));
    const cone = (v > 11 ? 20 : v > 5 ? 30 : 45) + (Math.atan2(acc, Math.max(d, 1)) * 180) / Math.PI;
    const lateral = d * Math.sin((Math.abs(rel) * Math.PI) / 180);
    const ahead = Math.abs(rel) <= cone && lateral <= 20 + acc * 0.5;
    return { ahead, d, rel, inside: false };
  }

  private isActive(meta: HazardMeta, ctx: RideContext): boolean {
    switch (meta.activeWhen) {
      case 'night':        return ctx.night;
      case 'dusk_dawn':    return ctx.duskDawn || ctx.night;
      case 'school_hours': return ctx.schoolHours;
      case 'rain':
      case 'monsoon_season': return ctx.raining;
      default:             return true;
    }
  }

  /** Severity after vehicle, conditions, trust and familiarity adjustments. */
  private effectiveLevel(h: Hazard, meta: HazardMeta, ctx: RideContext): { level: Severity; tentative: boolean } {
    let rank = LEVEL_RANK[h.severity];
    const vulnerable = this.cfg.vehicle === '2w' || this.cfg.vehicle === '3w';
    // A pothole you can't see at night on a bike is a crash, not a nuisance
    if (meta.twoWheelerBoost && vulnerable && (ctx.night || ctx.raining)) rank += 1;
    // Agency says fixed but not yet confirmed: still warn, softly
    if (h.status === 'resolved_pending_check') rank -= 1;
    const tentative = (h.trustTier === 3 && h.status === 'candidate') || h.confidence < 0.5;
    if (tentative) rank = Math.min(rank, LEVEL_RANK.warning);
    rank = Math.max(0, Math.min(2, rank));
    return { level: RANK_LEVEL[rank], tentative };
  }

  /** Familiar hazards on a daily route: keep earcon + haptic, drop the voice. */
  private isFamiliar(h: Hazard, meta: HazardMeta): boolean {
    if (this.cfg.mode === 'novice') return false;
    if (meta.persistence === 'transient' || meta.family === 'obstacle' || meta.family === 'people') return false;
    if (h.type === 'wrong_side_hot_zone') return false;     // the danger is other people, not the road
    const f = this.familiarity.get(h.id);
    if (!f) return false;
    const total = f.safe + f.rough;
    return f.safe >= FAMILIAR_SAFE_PASSES && f.safe / total >= 0.8;
  }

  private maybeStretch(surface: { h: Hazard; d: number; rel: number; level: Severity }[], v: number, fix: Fix,
                       raining: boolean): Cue | null {
    if (this.stretch) return null;
    const inWindow = surface.filter(c => c.d <= STRETCH_GROUP_WINDOW_M && this.state(c.h.id).alertedLevel === null)
                            .sort((a, b) => a.d - b.d);
    if (inWindow.length < STRETCH_GROUP_MIN) return null;
    const first = inWindow[0];
    if (first.d > this.lookahead(v, 'warning', raining) + v * LATENCY_S) return null;   // announce when the first one is due
    const span = inWindow[inWindow.length - 1].d - first.d + 50;
    this.stretch = { ids: new Set(inWindow.map(c => c.h.id)) };
    for (const c of inWindow) {
      const s = this.state(c.h.id);
      s.coveredByStretch = true;
      s.alertedLevel = 'warning';
      s.alertedAtMs = fix.tMs;
      s.speedAtAlertMps = v;
    }
    const L = this.cfg.lang;
    return {
      hazardId: first.h.id, hazardType: 'pothole_dense_stretch', level: 'warning', kind: 'stretch_start',
      distanceM: first.d, timeToHazardS: v > 0.5 ? first.d / v : Infinity,
      speech: `${ROUGH_STRETCH[L]}, ${UNITS[L].next} ${speakDistance(span, L)}`,
      earcon: EARCON.stretch_start, haptic: HAPTIC.stretch_start, pan: 0,
      visual: { color: COLORS.warning, flash: false }, tentative: false,
    };
  }

  private buildCue(h: Hazard, meta: HazardMeta, level: Severity, kind: CueKind, d: number,
                   tth: number, rel: number, fix: Fix, tentative: boolean): Cue {
    const L = this.cfg.lang;
    const urgent = kind === 'urgent_repeat';
    const familiar = this.isFamiliar(h, meta);
    let speech: string | null;
    if (urgent) speech = URGENT_WORD[L];
    else if (familiar) speech = null;
    else if (level === 'info' && this.cfg.mode !== 'novice') speech = null;
    else speech = `${tentative ? POSSIBLE[L] : ''}${meta.label[L]}, ${speakDistance(d, L)}`;

    const key = urgent ? 'critical_urgent' : level;
    return {
      hazardId: h.id, hazardType: h.type, level, kind, distanceM: Math.round(d),
      timeToHazardS: Number.isFinite(tth) ? Math.round(tth * 10) / 10 : Infinity,
      speech,
      earcon: familiar && level === 'info' ? null : EARCON[key],
      haptic: HAPTIC[key],
      // Directional audio only when GPS is good enough to know left from right
      pan: fix.accuracyM <= 25 ? Math.max(-1, Math.min(1, Math.sin((rel * Math.PI) / 180) * 1.5)) : 0,
      visual: { color: COLORS[level], flash: level === 'critical' },
      tentative,
    };
  }

  /** At most one spoken prompt per VOICE_GAP_MS; critical preempts, others go silent-but-buzz. */
  private applyVoicePolicy(cues: Cue[], tMs: number): void {
    cues.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
    let spokeThisTick = false;
    for (const c of cues) {
      if (!c.speech) continue;
      const gapOk = tMs - this.lastVoiceMs >= VOICE_GAP_MS;
      if ((gapOk && !spokeThisTick) || (c.level === 'critical' && !spokeThisTick)) {
        this.lastVoiceMs = tMs;
        spokeThisTick = true;
      } else {
        c.speech = null;                 // keep earcon + haptic, drop words
      }
    }
  }

  private completePass(h: Hazard, st: HazardState, fix: Fix): PassEvent {
    st.passedAtMs = fix.tMs;
    const target = { lat: h.lat, lon: h.lon };
    const jolted = this.jolts.some(j => Math.abs(j.tMs - fix.tMs) <= 6000 && haversine(j, target) <= 40);
    const ref = st.speedAtAlertMps > 0 ? st.speedAtAlertMps : st.speedAtMinDist;
    const slowed = st.speedAtMinDist <= Math.max(0.8 * ref, 20 / 3.6);
    const f = this.familiarity.get(h.id) ?? { safe: 0, rough: 0 };
    if (slowed && !jolted) f.safe += 1; else f.rough += 1;
    this.familiarity.set(h.id, f);
    return { hazardId: h.id, hazardType: h.type, status: h.status, slowed, jolted, tMs: fix.tMs };
  }

  /** Bound memory: forget hazards we are far from (cooldown no longer relevant). */
  private prune(_here: LatLon): void {
    if (this.states.size < 200) return;
    for (const [id, s] of this.states) {
      if (s.lastDist > 2000) this.states.delete(id);
    }
  }
}

// ------------------------------------------------------------ in-memory store
/** Simple store for tests and for the first app build before SQLite is wired. */
export class MemoryHazardStore implements HazardStore {
  hazards: Hazard[];
  constructor(hazards: Hazard[]) { this.hazards = hazards; }
  query(center: LatLon, radiusM: number): Hazard[] {
    return this.hazards.filter(h => {
      if (h.extent && h.extent.length >= 2) {
        return distanceToPolyline(center, h.extent).distance <= radiusM;
      }
      return haversine(center, h) <= radiusM;
    });
  }
}
