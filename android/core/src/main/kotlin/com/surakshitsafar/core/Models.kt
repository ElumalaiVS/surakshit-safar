package com.surakshitsafar.core

data class LatLon(val lat: Double, val lon: Double)

enum class Severity { INFO, WARNING, CRITICAL;
    val rank: Int get() = ordinal
    companion object {
        fun fromRank(r: Int): Severity = entries[r.coerceIn(0, 2)]
        fun parse(s: String): Severity = valueOf(s.uppercase())
    }
}

/** A live hazard as cached on the phone (mirror of server road_hazards, rider-relevant subset). */
data class Hazard(
    val id: String,
    val type: String,
    val lat: Double,
    val lon: Double,
    val extent: List<LatLon>? = null,     // stretches
    val bearingDeg: Int? = null,          // directional hazards
    val severity: Severity,
    val status: String,                   // server hazard_status
    val trustTier: Int,                   // 1 authority, 2 community, 3 telemetry
    val confidence: Double,
    val expiresAtMs: Long? = null,
) {
    val point: LatLon get() = LatLon(lat, lon)
}

fun interface HazardStore {
    /** Live hazards whose bbox intersects the circle. */
    fun query(center: LatLon, radiusM: Double, nowMs: Long): List<Hazard>
}

data class Fix(
    val lat: Double,
    val lon: Double,
    val speedMps: Double,
    val headingDeg: Double?,              // GPS course; unreliable at low speed
    val accuracyM: Double,
    val tMs: Long,
) {
    val point: LatLon get() = LatLon(lat, lon)
}

data class RideContext(
    val night: Boolean = false,
    val duskDawn: Boolean = false,
    val schoolHours: Boolean = false,
    val raining: Boolean = false,
)

enum class VehicleClass(val decelMps2: Double) {
    TWO_WHEELER(3.5), THREE_WHEELER(3.0), CAR(4.5), BUS(3.0), TRUCK(2.5);
    val vulnerable: Boolean get() = this == TWO_WHEELER || this == THREE_WHEELER
}

enum class RiderMode { NOVICE, STANDARD, GIG }

enum class Lang(val code: String) { EN("en"), TE("te"), HI("hi"), TA("ta") }

data class EngineConfig(
    val vehicle: VehicleClass = VehicleClass.TWO_WHEELER,
    val mode: RiderMode = RiderMode.STANDARD,
    val lang: Lang = Lang.TE,
    val route: List<LatLon>? = null,      // planned route if known
    val funMode: Boolean = true,          // playful lines for speed nudges only (never hazard cues)
    val cruiseLimitKmh: Double? = null,   // rider-chosen comfort limit; null = per-vehicle default
)

enum class CueKind { APPROACH, URGENT_REPEAT, STRETCH_START, STRETCH_END, SPEED_NUDGE, SPEED_PRAISE }

/**
 * Earcon described as data, so the app can synthesize it at runtime (no audio assets
 * needed) and tests can assert on it. Each tone: frequency Hz, duration ms, then gap ms.
 */
enum class Earcon(val tones: List<Triple<Int, Int, Int>>, val volume: Float) {
    CRITICAL(listOf(Triple(880, 180, 20), Triple(1175, 180, 20), Triple(1568, 240, 0)), 1.0f),
    CRITICAL_URGENT(List(4) { Triple(1568, 90, 50) }, 1.0f),
    WARNING(listOf(Triple(660, 120, 80), Triple(660, 120, 0)), 0.8f),
    INFO(listOf(Triple(440, 120, 0)), 0.45f),
    STRETCH_START(listOf(Triple(520, 80, 50), Triple(620, 80, 50), Triple(720, 80, 0)), 0.75f),
    STRETCH_END(listOf(Triple(720, 70, 60), Triple(520, 90, 0)), 0.4f),
    // gentle falling two-tone: "ease off", deliberately unlike any hazard tone
    NUDGE(listOf(Triple(784, 110, 60), Triple(587, 160, 0)), 0.5f),
}

/** Android VibrationEffect.createWaveform timings: [off, on, off, on, ...] ms. */
object Haptics {
    val CRITICAL = longArrayOf(0, 400, 120, 400, 120, 600)
    val CRITICAL_URGENT = longArrayOf(0, 150, 60, 150, 60, 150, 60, 150, 60, 600)
    val WARNING = longArrayOf(0, 180, 140, 180)
    val INFO = longArrayOf(0, 60)
    val STRETCH_START = longArrayOf(0, 90, 70, 90, 70, 90)
    val STRETCH_END = longArrayOf(0, 40, 200, 40)
    val NUDGE = longArrayOf(0, 70, 90, 70)
}

data class Cue(
    val hazardId: String,
    val hazardType: String,
    val level: Severity,
    val kind: CueKind,
    val distanceM: Int,
    val timeToHazardS: Double,
    val speech: String?,                  // null = earcon/haptic only
    val earcon: Earcon?,
    val haptic: LongArray,
    val pan: Double,                      // -1 left .. +1 right
    val colorArgb: Long,
    val flash: Boolean,
    val tentative: Boolean,
    val speedKmh: Int? = null,            // set on speed nudges
) {
    // LongArray breaks data-class equality; compare by identity fields only
    override fun equals(other: Any?): Boolean =
        other is Cue && other.hazardId == hazardId && other.kind == kind && other.level == level
    override fun hashCode(): Int = (hazardId.hashCode() * 31 + kind.hashCode()) * 31 + level.hashCode()
}

data class PassEvent(
    val hazardId: String,
    val hazardType: String,
    val status: String,
    val slowed: Boolean,
    val jolted: Boolean,
    val tMs: Long,
)

data class UpdateResult(val cues: List<Cue>, val passes: List<PassEvent>, val lookaheadM: Double)
