package com.surakshitsafar.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

class DetectorsTest {

    private val g = JoltDetector.G

    private class Rng(private var seed: Long) {
        fun next(): Double { seed = (seed * 1664525 + 1013904223) and 0xFFFFFFFFL; return seed / 4294967296.0 - 0.5 }
    }

    private class S(val tMs: Long, val ax: Double, val ay: Double, val az: Double)

    /** 50 Hz trace for a phone tilted [tiltDeg]; [vertical] is true vertical dynamic accel in g. */
    private fun trace(seconds: Double, tiltDeg: Double = 60.0, noise: Double = 0.06, seed: Long = 7,
                      vertical: (Double) -> Double): List<S> {
        val r = Rng(seed)
        val th = tiltDeg * PI / 180
        val upY = sin(th); val upZ = cos(th)
        return (0 until (seconds * 50).toInt()).map { i ->
            val t = i / 50.0
            val a = (1 + vertical(t)) * g
            S(1000L + i * 20L, r.next() * noise * g * 2, upY * a + r.next() * noise * g * 2, upZ * a + r.next() * noise * g * 2)
        }
    }

    private fun run(samples: List<S>, kmh: Double): List<JoltEvent> {
        val d = JoltDetector()
        return samples.mapNotNull { d.push(it.tMs, it.ax, it.ay, it.az, kmh) }
    }

    private fun pothole(t0: Double): (Double) -> Double = { t ->
        val d = t - t0
        when {
            d >= 0 && d < 0.06 -> -0.7
            d >= 0.06 && d < 0.10 -> 1.5
            d >= 0.10 && d < 0.16 -> -0.3
            else -> 0.0
        }
    }

    private fun hump(t0: Double): (Double) -> Double = { t ->
        val d = t - t0
        when {
            d >= 0 && d < 0.30 -> 0.7 * sin(PI * d / 0.30)
            d >= 0.30 && d < 0.55 -> -0.5 * sin(PI * (d - 0.30) / 0.25)
            else -> 0.0
        }
    }

    @Test fun smoothRoadNoEvents() {
        assertEquals(0, run(trace(20.0, noise = 0.08) { 0.0 }, 50.0).size)
    }

    @Test fun potholeAnyMountAngle() {
        for (tilt in listOf(0.0, 35.0, 60.0, 85.0)) {
            val ev = run(trace(6.0, tilt, vertical = pothole(3.0)), 40.0)
            assertEquals("tilt $tilt", 1, ev.size)
            assertEquals(JoltKind.POTHOLE, ev[0].kind)
            assertTrue(ev[0].rawPeakG > 1.2)
        }
    }

    @Test fun humpClassified() {
        val ev = run(trace(6.0, vertical = hump(3.0)), 25.0)
        assertEquals(1, ev.size)
        assertEquals(JoltKind.HUMP, ev[0].kind)
        assertTrue(ev[0].spatialLenM >= 1.5)
    }

    @Test fun frontAndRearWheelOneEvent() {
        val p1 = pothole(3.0); val p2 = pothole(3.12)
        assertEquals(1, run(trace(6.0) { t -> p1(t).takeIf { it != 0.0 } ?: p2(t) }, 40.0).size)
    }

    @Test fun twoPotholesTwoEvents() {
        val p1 = pothole(2.0); val p2 = pothole(5.0)
        assertEquals(2, run(trace(8.0) { t -> p1(t).takeIf { it != 0.0 } ?: p2(t) }, 40.0).size)
    }

    @Test fun belowMinSpeedSilent() {
        assertEquals(0, run(trace(6.0, vertical = pothole(3.0)), 8.0).size)
    }

    @Test fun phonePickedUpSuppressed() {
        val r = Rng(3)
        val samples = (0 until 300).map { i ->
            val t = i / 50.0
            val tilt = if (t < 2) 60.0 else if (t < 2.4) 60 - (t - 2) * 125 else 10.0
            val th = tilt * PI / 180
            val bump = if (t > 2.1 && t < 2.2) 0.9 else 0.0
            val a = (1 + bump) * g
            S(1000L + i * 20L, r.next() * 0.5, sin(th) * a + r.next() * 0.5, cos(th) * a + r.next() * 0.5)
        }
        assertEquals(0, run(samples, 30.0).size)
    }

    @Test fun hardBrakeFlaggedGentleNot() {
        val hb = HardBrakeDetector()
        val ev = listOf(60, 60, 60, 45, 30, 15, 15).mapIndexedNotNull { i, k -> hb.push(i * 1000L, k / 3.6) }
        assertEquals(1, ev.size)
        assertTrue(ev[0].decelG >= 0.38)
        val gentle = HardBrakeDetector()
        assertEquals(0, listOf(60, 55, 50, 45, 40, 35, 30, 25, 20).mapIndexedNotNull { i, k -> gentle.push(i * 1000L, k / 3.6) }.size)
    }

    @Test fun dayDuskNightInTirupati() {
        val ist = ZoneId.of("Asia/Kolkata")
        val ctx = RideContextProvider(ist)
        fun t(h: Int, m: Int) = ZonedDateTime.of(2026, 11, 14, h, m, 0, 0, ist).toInstant().toEpochMilli()
        val noon = ctx.at(t(12, 0), 13.63, 79.42)
        assertFalse(noon.night); assertFalse(noon.duskDawn)
        val dusk = ctx.at(t(17, 45), 13.63, 79.42)            // just after sunset (~17:40 IST)
        assertTrue(dusk.duskDawn); assertFalse(dusk.night)
        val late = ctx.at(t(20, 30), 13.63, 79.42)
        assertTrue(late.night)
        assertTrue(ctx.at(t(8, 30), 13.63, 79.42).schoolHours)    // Saturday 8:30
        assertFalse(ctx.at(t(11, 0), 13.63, 79.42).schoolHours)
        val noonElev = Sun.elevationDeg(t(12, 10), 13.63, 79.42)
        assertTrue("noon elevation $noonElev", noonElev in 55.0..62.0)  // ~58 deg in mid-Nov at 13.6 N
    }
}
