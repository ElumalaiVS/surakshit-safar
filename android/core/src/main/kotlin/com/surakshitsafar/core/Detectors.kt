package com.surakshitsafar.core

import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sign
import kotlin.math.sqrt

// =============================================================================
//  Tier-3 passive telemetry: potholes, unmarked humps (accelerometer) and hard
//  braking (GPS speed). Orientation-independent: the phone can be mounted at any angle.
//
//  1. Low-pass -> gravity vector g (tau ~1 s). Its direction = "down" for this mount.
//  2. Vertical dynamic accel a_v = dot(a, g_hat) - |g|  (positive = pushed up).
//  3. Handling rejection: g_hat swings > 20 deg within 1 s -> phone is in a hand.
//  4. Trigger when |a_v| > 0.30 g + 0.004 g per km/h; capture until quiet.
//  5. Classify: UP first and >= 1.5 m long -> hump; DROP first or short -> pothole.
//  Only events leave the phone, never raw traces.
// =============================================================================

enum class JoltKind(val wire: String) {
    POTHOLE("vertical_jolt_pothole"), HUMP("vertical_jolt_hump")
}

data class JoltEvent(
    val kind: JoltKind,
    val tMs: Long,
    val peakG: Double,         // speed-normalised, comparable across speeds
    val rawPeakG: Double,
    val durationMs: Long,
    val spatialLenM: Double,
    val speedKmh: Double,
)

data class JoltConfig(
    val minSpeedKmh: Double = 12.0,
    val baseThresholdG: Double = 0.30,
    val perKmhG: Double = 0.004,
    val quietG: Double = 0.12,
    val quietMs: Long = 150,
    val maxEventMs: Long = 1500,
    val refractoryMs: Long = 1000,     // front + rear wheel over one pothole = one event
    val handlingDeg: Double = 20.0,    // hard braking tilts g ~10-14 deg; a hand swings it more
)

class JoltDetector(private val cfg: JoltConfig = JoltConfig()) {

    private class Sample(val tMs: Long, val v: Double)
    private class Dir(val tMs: Long, val x: Double, val y: Double, val z: Double)

    private var gx = 0.0; private var gy = 0.0; private var gz = 0.0
    private var hasG = false
    private val gHistory = ArrayDeque<Dir>()
    private var handlingUntilMs = 0L
    private var refractoryUntilMs = 0L
    private var burst: MutableList<Sample>? = null
    private var lastLoudMs = 0L
    private var lastTMs = 0L

    /** True while the gravity estimate is stable: used to gate sensor sampling (battery). */
    val isMounted: Boolean get() = hasG && lastTMs >= handlingUntilMs

    /** Feed one accelerometer sample (m/s^2, including gravity) with the latest GPS speed. */
    fun push(tMs: Long, ax: Double, ay: Double, az: Double, speedKmh: Double): JoltEvent? {
        val dt = if (lastTMs != 0L) max(1L, tMs - lastTMs) else 20L
        lastTMs = tMs

        // 1. gravity estimate, time constant ~1 s regardless of sample rate
        val alpha = min(1.0, dt / 1000.0)
        if (!hasG) { gx = ax; gy = ay; gz = az; hasG = true } else {
            gx += alpha * (ax - gx); gy += alpha * (ay - gy); gz += alpha * (az - gz)
        }
        val gn = sqrt(gx * gx + gy * gy + gz * gz).takeIf { it > 0 } ?: G
        val ux = gx / gn; val uy = gy / gn; val uz = gz / gn

        // 3. handling detection: gravity direction vs ~1 s ago
        gHistory.addLast(Dir(tMs, ux, uy, uz))
        while (gHistory.isNotEmpty() && tMs - gHistory.first().tMs > 1000) gHistory.removeFirst()
        val old = gHistory.first()
        val cos = (old.x * ux + old.y * uy + old.z * uz).coerceIn(-1.0, 1.0)
        if (Math.toDegrees(acos(cos)) > cfg.handlingDeg) {
            handlingUntilMs = tMs + 2000
            burst = null
        }

        // 2. vertical dynamic acceleration in g
        val vG = (ax * ux + ay * uy + az * uz - gn) / G

        if (tMs < handlingUntilMs || speedKmh < cfg.minSpeedKmh) { burst = null; return null }

        val thr = cfg.baseThresholdG + cfg.perKmhG * speedKmh
        val b = burst
        if (b == null) {
            if (tMs >= refractoryUntilMs && abs(vG) > thr) {
                burst = mutableListOf(Sample(tMs, vG))
                lastLoudMs = tMs
            }
            return null
        }
        b += Sample(tMs, vG)
        if (abs(vG) > cfg.quietG) lastLoudMs = tMs
        val quiet = tMs - lastLoudMs >= cfg.quietMs
        val tooLong = tMs - b.first().tMs >= cfg.maxEventMs
        if (!quiet && !tooLong) return null

        burst = null
        refractoryUntilMs = tMs + cfg.refractoryMs
        return classify(b, speedKmh, thr)
    }

    private fun classify(b: List<Sample>, speedKmh: Double, thr: Double): JoltEvent {
        val half = thr * 0.5
        val first = b.firstOrNull { abs(it.v) > half } ?: b.first()
        val last = b.lastOrNull { abs(it.v) > half } ?: b.last()
        val durationMs = max(20L, last.tMs - first.tMs)
        val spatialLenM = durationMs / 1000.0 * (speedKmh / 3.6)
        val rawPeak = b.maxOf { abs(it.v) }
        val peak = rawPeak * sqrt(30.0 / max(speedKmh, 15.0))
        val kind = if (sign(first.v) > 0 && spatialLenM >= 1.5) JoltKind.HUMP else JoltKind.POTHOLE
        return JoltEvent(kind, first.tMs, round3(peak), round3(rawPeak), durationMs,
            (spatialLenM * 100).roundToInt() / 100.0, speedKmh)
    }

    private fun round3(x: Double) = (x * 1000).roundToInt() / 1000.0

    companion object { const val G = 9.80665 }
}

data class HardBrakeEvent(val tMs: Long, val decelG: Double, val fromKmh: Int, val toKmh: Int)

/** Hard braking from GPS Doppler speed: decel >= 0.4 g sustained >= 1 s from >= 20 km/h. */
class HardBrakeDetector(
    private val thresholdG: Double = 0.4,
    private val minSustainMs: Long = 1000,
    private val minFromKmh: Double = 20.0,
) {
    private class S(val tMs: Long, val v: Double)
    private val series = ArrayDeque<S>()
    private var cooldownUntil = 0L

    fun push(tMs: Long, speedMps: Double): HardBrakeEvent? {
        series.addLast(S(tMs, speedMps))
        while (series.isNotEmpty() && tMs - series.first().tMs > 4000) series.removeFirst()
        if (tMs < cooldownUntil || series.size < 2) return null

        var i = series.size - 1
        while (i > 0) {
            val a = series[i - 1]; val b = series[i]
            val dec = (a.v - b.v) / ((b.tMs - a.tMs) / 1000.0)
            if (dec / JoltDetector.G < thresholdG) break
            i--
        }
        val start = series[i]; val end = series.last()
        val span = end.tMs - start.tMs
        if (span >= minSustainMs && start.v * 3.6 >= minFromKmh) {
            cooldownUntil = tMs + 5000
            val decelG = (start.v - end.v) / (span / 1000.0) / JoltDetector.G
            return HardBrakeEvent(start.tMs, (decelG * 100).roundToInt() / 100.0,
                (start.v * 3.6).roundToInt(), (end.v * 3.6).roundToInt())
        }
        return null
    }
}
