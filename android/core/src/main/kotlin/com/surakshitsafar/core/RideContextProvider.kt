package com.surakshitsafar.core

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

/**
 * Derives [RideContext] offline: night / dusk-dawn from the sun's elevation at the
 * rider's position (no network), school hours from local time, rain from a provider
 * (rider toggle today; weather feed later).
 */
class RideContextProvider(
    private val zone: ZoneId = ZoneId.of("Asia/Kolkata"),
    private val raining: () -> Boolean = { false },
    private val schoolWindows: List<Pair<LocalTime, LocalTime>> = listOf(
        LocalTime.of(8, 0) to LocalTime.of(9, 45),
        LocalTime.of(15, 30) to LocalTime.of(17, 15),
    ),
) {
    fun at(tMs: Long, lat: Double, lon: Double): RideContext {
        val elev = Sun.elevationDeg(tMs, lat, lon)
        val local = Instant.ofEpochMilli(tMs).atZone(zone)
        val school = local.dayOfWeek != DayOfWeek.SUNDAY &&
            schoolWindows.any { (a, b) -> !local.toLocalTime().isBefore(a) && local.toLocalTime().isBefore(b) }
        return RideContext(
            night = elev < -6.0,                       // below civil twilight
            duskDawn = elev >= -6.0 && elev < 6.0,     // low sun: glare, dusk cattle movement
            schoolHours = school,
            raining = raining(),
        )
    }
}

/** Low-precision solar position (~0.5 deg), enough to tell day from dusk from night. */
object Sun {
    fun elevationDeg(tMs: Long, lat: Double, lon: Double): Double {
        val n = tMs / 86_400_000.0 + 2440587.5 - 2451545.0       // days since J2000
        val l = Math.toRadians((280.460 + 0.9856474 * n).mod(360.0))
        val g = Math.toRadians((357.528 + 0.9856003 * n).mod(360.0))
        val lambda = l + Math.toRadians(1.915) * sin(g) + Math.toRadians(0.020) * sin(2 * g)
        val eps = Math.toRadians(23.439 - 0.0000004 * n)
        val ra = atan2(cos(eps) * sin(lambda), cos(lambda))
        val dec = asin(sin(eps) * sin(lambda))
        val gmstHours = (18.697374558 + 24.06570982441908 * n).mod(24.0)
        val ha = Math.toRadians(gmstHours * 15 + lon) - ra
        val phi = Math.toRadians(lat)
        return Math.toDegrees(asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(ha)))
    }
}
