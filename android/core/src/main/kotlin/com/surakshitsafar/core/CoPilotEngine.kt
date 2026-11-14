package com.surakshitsafar.core

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * On-device, offline hazard alerting. Call [update] once per GPS fix (~1 Hz).
 *
 * Pure logic: no Android, no I/O, no timers. The service feeds fixes + context and
 * plays the returned cues. Kotlin port of edge/src/alertEngine.ts (same rules, same tests).
 *
 *  1. Warn early enough to stop:  lookahead grows with speed (stopping distance).
 *  2. Only what is ahead of *me*: heading cone or route corridor + direction filter.
 *  3. Never cry wolf:            familiarity, grouping, voice spacing, low-speed mute.
 *  4. Never go silent on danger: critical bypasses fatigue rules; urgent repeat if not slowing.
 *  5. Attention budget: at most 4 non-critical spoken prompts per 5 minutes, all sources combined.
 *  6. Speed nudges ([SpeedCoach]) only when no hazard cue is due: hazards always win.
 *
 * Not thread-safe: call from a single thread (the service's location callback looper).
 */
class CoPilotEngine(
    private val store: HazardStore,
    config: EngineConfig,
    private val coach: SpeedCoach = SpeedCoach(),
) {

    var config: EngineConfig = config
        private set

    fun updateConfig(transform: (EngineConfig) -> EngineConfig) { config = transform(config) }

    private class HazardState {
        var alertedLevel: Severity? = null
        var alertedAtMs = 0L
        var speedAtAlertMps = 0.0
        var urgentSent = false
        var minDist = Double.POSITIVE_INFINITY
        var speedAtMinDist = 0.0
        var lastDist = Double.POSITIVE_INFINITY
        var passedAtMs: Long? = null
        var coveredByStretch = false
    }

    data class Familiarity(var safe: Int, var rough: Int)

    private data class Jolt(val tMs: Long, val at: LatLon)

    private data class Candidate(
        val h: Hazard, val meta: HazardMeta, val d: Double, val rel: Double,
        val inside: Boolean, val level: Severity, val tentative: Boolean,
    )

    private data class Relation(val ahead: Boolean, val d: Double, val rel: Double, val inside: Boolean)

    private val states = HashMap<String, HazardState>()
    private val familiarity = HashMap<String, Familiarity>()
    private val jolts = ArrayDeque<Jolt>()
    private var lastVoiceMs = Long.MIN_VALUE / 2
    private val nonCriticalVoice = ArrayDeque<Long>()
    private var lastHazardCueMs = Long.MIN_VALUE / 2
    private var lastHeading: Double? = null
    private var lastFix: Fix? = null
    private var stretchIds: Set<String>? = null

    // ----------------------------------------------------------------- public API

    fun loadFamiliarity(rows: Map<String, Familiarity>) { familiarity.putAll(rows.mapValues { it.value.copy() }) }
    fun familiarityOf(id: String): Familiarity? = familiarity[id]?.copy()
    fun familiaritySnapshot(): Map<String, Familiarity> = familiarity.mapValues { it.value.copy() }

    /** Feed from [JoltDetector] so pass events know whether the rider hit the hazard. */
    fun noteJolt(tMs: Long, lat: Double, lon: Double) {
        jolts.addLast(Jolt(tMs, LatLon(lat, lon)))
        if (jolts.size > 50) jolts.removeFirst()
    }

    /** Distance at which a hazard of this severity must be announced, metres. */
    fun lookahead(speedMps: Double, sev: Severity, raining: Boolean): Double {
        val novice = config.mode == RiderMode.NOVICE
        val reaction = if (novice) 2.0 else 1.3
        val decel = config.vehicle.decelMps2 * (if (raining) 0.7 else 1.0)
        val stopping = speedMps * reaction + speedMps * speedMps / (2 * decel)
        val lead = (LEAD_TIME_S.getValue(sev) + if (novice) 1.5 else 0.0) * speedMps
        val d = maxOf(stopping * 1.25 + 15, lead, MIN_LOOKAHEAD_M.getValue(sev))
        return min(d, MAX_LOOKAHEAD_M)
    }

    fun update(fix: Fix, ctx: RideContext): UpdateResult {
        val cues = ArrayList<Cue>()
        val passes = ArrayList<PassEvent>()
        val v = max(0.0, fix.speedMps)
        val heading = resolveHeading(fix)
        val here = fix.point
        val maxLook = lookahead(v, Severity.CRITICAL, ctx.raining)
        val queryR = max(maxLook, STRETCH_GROUP_WINDOW_M) + fix.accuracyM + 50

        val hazards = store.query(here, queryR, fix.tMs)
            .filter { it.expiresAtMs == null || it.expiresAtMs > fix.tMs }

        // --- 1. geometry: which hazards are ahead, how far, which side; pass detection
        val ahead = ArrayList<Candidate>()
        val activeZones = ArrayList<String>()
        for (h in hazards) {
            val meta = Taxonomy[h.type] ?: continue
            if (!meta.riderAlert) continue
            var st = state(h.id)
            val geo = relate(here, heading, fix.accuracyM, h, meta, v)

            // Re-arm: cooldown over and well away, or approach abandoned (turned off)
            val passedAt = st.passedAtMs
            if ((passedAt != null && fix.tMs - passedAt >= COOLDOWN_MS && geo.d > 300) ||
                (passedAt == null && st.alertedLevel != null && geo.d > st.minDist + 500)) {
                states.remove(h.id)
                st = state(h.id)
            }

            if (geo.d < st.minDist) { st.minDist = geo.d; st.speedAtMinDist = v }
            if (st.passedAtMs == null && st.minDist <= PASS_RADIUS_M &&
                geo.d > st.minDist + 8 && geo.d > st.lastDist) {
                passes += completePass(h, st, fix)
            }
            st.lastDist = geo.d

            // Am I in an active zone (school, cattle, dark stretch...)? Feeds speed nudges.
            // Point zones count while approaching or right at them; once passed, they're behind you.
            val zoneR = SpeedCoach.ZONE_RADIUS_M[h.type]
            if (zoneR != null && isActive(meta, ctx) &&
                (if (h.extent != null) geo.inside
                 else geo.d <= zoneR && st.passedAtMs == null && (geo.ahead || geo.d <= 40))) {
                activeZones += h.type
            }

            if (!geo.ahead || heading == null) continue
            if (!isActive(meta, ctx)) continue
            val pa = st.passedAtMs
            if (pa != null && fix.tMs - pa < COOLDOWN_MS) continue

            val (level, tentative) = effectiveLevel(h, meta, ctx)
            if (tentative && level == Severity.INFO && config.mode != RiderMode.NOVICE) continue
            ahead += Candidate(h, meta, geo.d, geo.rel, geo.inside, level, tentative)
        }

        // --- 2. low-speed mute
        if (v < LOW_SPEED_MUTE_MPS) {
            prune()
            lastFix = fix
            return UpdateResult(cues, passes, maxLook)
        }

        // --- 3. grouping: many potholes close together -> one "rough road" cue
        maybeStretch(
            ahead.filter { it.meta.family == Family.SURFACE && it.level != Severity.CRITICAL && !it.meta.isStretch },
            v, fix, ctx.raining,
        )?.let { cues += it }

        // --- 4. per-hazard approach / urgent cues
        ahead.sortWith(compareByDescending<Candidate> { it.level.rank }.thenBy { it.d })
        for (c in ahead) {
            val st = state(c.h.id)
            if (st.coveredByStretch) continue
            val look = lookahead(v, c.level, ctx.raining)
            val tth = if (v > 0.5) c.d / v else Double.POSITIVE_INFINITY
            val prev = st.alertedLevel

            if (prev == null || c.level.rank > prev.rank) {
                if (c.d <= look + v * LATENCY_S || c.inside) {
                    cues += buildCue(c.h, c.meta, c.level, CueKind.APPROACH, c.d, tth, c.rel, fix, c.tentative)
                    st.alertedLevel = c.level
                    st.alertedAtMs = fix.tMs
                    st.speedAtAlertMps = v
                }
            } else if (c.level == Severity.CRITICAL && !st.urgentSent && tth <= URGENT_TTH_S &&
                v >= 0.85 * st.speedAtAlertMps && v > 5) {
                cues += buildCue(c.h, c.meta, Severity.CRITICAL, CueKind.URGENT_REPEAT, c.d, tth, c.rel, fix, c.tentative)
                st.urgentSent = true
            }
        }

        // --- 5. stretch end
        stretchIds?.let { ids ->
            if (ids.all { state(it).passedAtMs != null }) {
                cues += Cue("stretch", "pothole_dense_stretch", Severity.INFO, CueKind.STRETCH_END, 0, 0.0,
                    null, null, Haptics.STRETCH_END, 0.0, COLORS.getValue(Severity.INFO), false, false)
                stretchIds = null
            }
        }

        // --- 6. speed coaching: only when no hazard needs the rider's attention
        if (cues.isNotEmpty()) lastHazardCueMs = fix.tMs
        // a warning that is coming up but not yet announced must get the voice slot first
        val hazardDue = ahead.any { it.level.rank >= Severity.WARNING.rank &&
            state(it.h.id).alertedLevel == null &&
            it.d <= lookahead(v, it.level, ctx.raining) * 2 + 50 }
        val hazardBusy = cues.isNotEmpty() || hazardDue || fix.tMs - lastHazardCueMs < 8_000
        if (heading != null) {
            coach.update(fix.tMs, v * 3.6, fix.accuracyM, config, ctx, activeZones, hazardBusy)?.let { n ->
                val praise = n.kind == CueKind.SPEED_PRAISE
                cues += Cue("speed", n.zoneType ?: "speed", Severity.INFO, n.kind, 0,
                    Double.POSITIVE_INFINITY, n.speech,
                    if (praise) null else Earcon.NUDGE, if (praise) LongArray(0) else Haptics.NUDGE,
                    0.0, COLORS.getValue(Severity.WARNING), false, false, speedKmh = (v * 3.6).roundToInt())
            }
        }

        applyVoicePolicy(cues, fix.tMs)
        // a praise line that lost its voice slot has nothing left to deliver
        cues.removeAll { it.speech == null && it.earcon == null && it.haptic.isEmpty() }
        prune()
        lastFix = fix
        return UpdateResult(cues.take(3), passes, maxLook)
    }

    // ------------------------------------------------------------------ internals

    private fun state(id: String): HazardState = states.getOrPut(id) { HazardState() }

    /** GPS course is junk below ~5 km/h: fall back to last good heading or movement vector. */
    private fun resolveHeading(fix: Fix): Double? {
        val prev = lastFix
        if (fix.headingDeg != null && fix.speedMps >= 1.5) {
            lastHeading = fix.headingDeg
        } else if (prev != null && Geo.haversine(prev.point, fix.point) > 5) {
            lastHeading = Geo.bearing(prev.point, fix.point)
        }
        return lastHeading
    }

    private fun relate(here: LatLon, heading: Double?, acc: Double, h: Hazard, meta: HazardMeta, v: Double): Relation {
        var target = h.point
        var d: Double
        var inside = false
        val ext = h.extent
        if (ext != null && ext.size >= 2) {
            d = Geo.distanceToPolyline(here, ext).distance
            inside = d <= 25 + acc * 0.5
            val a = ext.first()
            val b = ext.last()
            target = if (Geo.haversine(here, a) <= Geo.haversine(here, b)) a else b
            if (!inside) d = min(Geo.haversine(here, a), Geo.haversine(here, b))
        } else {
            d = Geo.haversine(here, target)
        }
        if (heading == null) return Relation(false, d, 0.0, inside)

        // Direction filter (hairpin pinned for downhill traffic, truck on one shoulder)
        val hb = h.bearingDeg
        if (meta.directional && hb != null && Geo.bearingDiff(heading, hb.toDouble()) > 50) {
            return Relation(false, d, 0.0, false)
        }
        if (inside) return Relation(true, 0.0, 0.0, true)

        // Route mode: along-route distance beats a straight cone on curvy roads
        val route = config.route
        if (route != null && route.size >= 2) {
            val me = Geo.distanceToPolyline(here, route)
            if (me.distance <= 50) {
                val hz = Geo.distanceToPolyline(target, route)
                val along = hz.alongM - me.alongM
                val isAhead = hz.distance <= 25 + acc * 0.5 && along > 0
                val rel = Geo.relativeBearing(heading, Geo.bearing(here, target))
                return Relation(isAhead, if (isAhead) along else d, rel, false)
            }
            // off-route (detour): fall through to cone mode
        }

        // Cone mode: narrower at speed
        val rel = Geo.relativeBearing(heading, Geo.bearing(here, target))
        val cone = (if (v > 11) 20.0 else if (v > 5) 30.0 else 45.0) + atan2(acc, max(d, 1.0)) * 180 / PI
        val lateral = d * sin(abs(rel) * PI / 180)
        return Relation(abs(rel) <= cone && lateral <= 20 + acc * 0.5, d, rel, false)
    }

    private fun isActive(meta: HazardMeta, ctx: RideContext): Boolean = when (meta.activeWhen) {
        ActiveWhen.NIGHT -> ctx.night
        ActiveWhen.DUSK_DAWN -> ctx.duskDawn || ctx.night
        ActiveWhen.SCHOOL_HOURS -> ctx.schoolHours
        ActiveWhen.RAIN -> ctx.raining
        ActiveWhen.ALWAYS -> true
    }

    /** Severity after vehicle, conditions and trust adjustments. */
    private fun effectiveLevel(h: Hazard, meta: HazardMeta, ctx: RideContext): Pair<Severity, Boolean> {
        var rank = h.severity.rank
        if (meta.twoWheelerBoost && config.vehicle.vulnerable && (ctx.night || ctx.raining)) rank += 1
        if (h.status == "resolved_pending_check") rank -= 1
        val tentative = (h.trustTier == 3 && h.status == "candidate") || h.confidence < 0.5
        if (tentative) rank = min(rank, Severity.WARNING.rank)
        return Severity.fromRank(rank) to tentative
    }

    /** Familiar hazards on a daily route keep earcon + haptic but drop the voice. */
    private fun isFamiliar(h: Hazard, meta: HazardMeta): Boolean {
        if (config.mode == RiderMode.NOVICE) return false
        if (meta.persistence == Persistence.TRANSIENT || meta.family == Family.OBSTACLE || meta.family == Family.PEOPLE) return false
        if (h.type == "wrong_side_hot_zone") return false
        val f = familiarity[h.id] ?: return false
        val total = f.safe + f.rough
        return f.safe >= FAMILIAR_SAFE_PASSES && f.safe.toDouble() / total >= 0.8
    }

    private fun maybeStretch(surface: List<Candidate>, v: Double, fix: Fix, raining: Boolean): Cue? {
        if (stretchIds != null) return null
        val inWindow = surface.filter { it.d <= STRETCH_GROUP_WINDOW_M && state(it.h.id).alertedLevel == null }
            .sortedBy { it.d }
        if (inWindow.size < STRETCH_GROUP_MIN) return null
        val first = inWindow.first()
        if (first.d > lookahead(v, Severity.WARNING, raining) + v * LATENCY_S) return null
        val span = inWindow.last().d - first.d + 50
        stretchIds = inWindow.map { it.h.id }.toSet()
        for (c in inWindow) {
            state(c.h.id).apply {
                coveredByStretch = true
                alertedLevel = Severity.WARNING
                alertedAtMs = fix.tMs
                speedAtAlertMps = v
            }
        }
        val l = config.lang
        return Cue(first.h.id, "pothole_dense_stretch", Severity.WARNING, CueKind.STRETCH_START,
            first.d.roundToInt(), if (v > 0.5) first.d / v else Double.POSITIVE_INFINITY,
            "${Taxonomy.roughStretch.getValue(l)}, ${Taxonomy.nextWord.getValue(l)} ${Taxonomy.speakDistance(span, l)}",
            Earcon.STRETCH_START, Haptics.STRETCH_START, 0.0, COLORS.getValue(Severity.WARNING), false, false)
    }

    private fun buildCue(h: Hazard, meta: HazardMeta, level: Severity, kind: CueKind, d: Double,
                         tth: Double, rel: Double, fix: Fix, tentative: Boolean): Cue {
        val l = config.lang
        val urgent = kind == CueKind.URGENT_REPEAT
        val familiar = isFamiliar(h, meta)
        val speech: String? = when {
            urgent -> Taxonomy.slowDown.getValue(l)
            familiar -> null
            level == Severity.INFO && config.mode != RiderMode.NOVICE -> null
            else -> (if (tentative) Taxonomy.possible.getValue(l) else "") +
                "${meta.label.getValue(l)}, ${Taxonomy.speakDistance(d, l)}"
        }
        val earcon = when {
            urgent -> Earcon.CRITICAL_URGENT
            familiar && level == Severity.INFO -> null
            else -> when (level) { Severity.CRITICAL -> Earcon.CRITICAL; Severity.WARNING -> Earcon.WARNING; Severity.INFO -> Earcon.INFO }
        }
        val haptic = if (urgent) Haptics.CRITICAL_URGENT else when (level) {
            Severity.CRITICAL -> Haptics.CRITICAL; Severity.WARNING -> Haptics.WARNING; Severity.INFO -> Haptics.INFO
        }
        val pan = if (fix.accuracyM <= 25) (sin(rel * PI / 180) * 1.5).coerceIn(-1.0, 1.0) else 0.0
        val tthOut = if (tth.isFinite()) (tth * 10).roundToInt() / 10.0 else Double.POSITIVE_INFINITY
        return Cue(h.id, h.type, level, kind, d.roundToInt(), tthOut, speech, earcon, haptic, pan,
            COLORS.getValue(level), level == Severity.CRITICAL, tentative)
    }

    /**
     * Voice is the most disruptive channel, so it is rationed:
     *  - one spoken prompt per tick, and at least VOICE_GAP_MS between prompts;
     *  - non-critical prompts (warnings, stretches, speed nudges) share a budget of
     *    VOICE_BUDGET per 5 minutes; over budget they keep only earcon + haptic;
     *  - critical always speaks.
     */
    private fun applyVoicePolicy(cues: MutableList<Cue>, tMs: Long) {
        cues.sortByDescending { it.level.rank }
        while (nonCriticalVoice.isNotEmpty() && tMs - nonCriticalVoice.first() > VOICE_BUDGET_WINDOW_MS) {
            nonCriticalVoice.removeFirst()
        }
        var spoke = false
        for (i in cues.indices) {
            val c = cues[i]
            if (c.speech == null) continue
            val critical = c.level == Severity.CRITICAL
            val gapOk = tMs - lastVoiceMs >= VOICE_GAP_MS
            val budgetOk = critical || nonCriticalVoice.size < VOICE_BUDGET
            if (!spoke && budgetOk && (gapOk || critical)) {
                lastVoiceMs = tMs
                spoke = true
                if (!critical) nonCriticalVoice.addLast(tMs)
            } else {
                cues[i] = c.copy(speech = null)
            }
        }
    }

    private fun completePass(h: Hazard, st: HazardState, fix: Fix): PassEvent {
        st.passedAtMs = fix.tMs
        val jolted = jolts.any { abs(it.tMs - fix.tMs) <= 6000 && Geo.haversine(it.at, h.point) <= 40 }
        val ref = if (st.speedAtAlertMps > 0) st.speedAtAlertMps else st.speedAtMinDist
        val slowed = st.speedAtMinDist <= max(0.8 * ref, 20 / 3.6)
        val f = familiarity.getOrPut(h.id) { Familiarity(0, 0) }
        if (slowed && !jolted) f.safe++ else f.rough++
        return PassEvent(h.id, h.type, h.status, slowed, jolted, fix.tMs)
    }

    private fun prune() {
        if (states.size < 200) return
        states.entries.removeAll { it.value.lastDist > 2000 }
    }

    companion object {
        private val LEAD_TIME_S = mapOf(Severity.CRITICAL to 7.0, Severity.WARNING to 5.0, Severity.INFO to 3.5)
        private val MIN_LOOKAHEAD_M = mapOf(Severity.CRITICAL to 60.0, Severity.WARNING to 40.0, Severity.INFO to 25.0)
        private const val MAX_LOOKAHEAD_M = 500.0
        private const val LOW_SPEED_MUTE_MPS = 8 / 3.6
        private const val VOICE_GAP_MS = 4000L
        const val COOLDOWN_MS = 10 * 60 * 1000L
        private const val URGENT_TTH_S = 3.0
        private const val LATENCY_S = 1.0
        private const val PASS_RADIUS_M = 30.0
        private const val STRETCH_GROUP_MIN = 3
        private const val STRETCH_GROUP_WINDOW_M = 400.0
        private const val FAMILIAR_SAFE_PASSES = 5
        const val VOICE_BUDGET = 4
        const val VOICE_BUDGET_WINDOW_MS = 5 * 60_000L

        val COLORS = mapOf(
            Severity.CRITICAL to 0xFFFF3B30, Severity.WARNING to 0xFFFFB300, Severity.INFO to 0xFF4FC3F7,
        )
    }
}

/** Simple in-memory store: tests and the first app build. */
class MemoryHazardStore(var hazards: List<Hazard>) : HazardStore {
    override fun query(center: LatLon, radiusM: Double, nowMs: Long): List<Hazard> = hazards.filter {
        val ext = it.extent
        if (ext != null && ext.size >= 2) Geo.distanceToPolyline(center, ext).distance <= radiusM
        else Geo.haversine(center, it.point) <= radiusM
    }
}
