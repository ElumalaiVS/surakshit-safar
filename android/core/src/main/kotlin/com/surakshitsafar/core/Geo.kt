package com.surakshitsafar.core

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/** Geodesy helpers for the 1 Hz alert loop. Pure functions, no allocation-heavy deps. */
object Geo {
    const val EARTH_R = 6371008.8
    private const val D2R = PI / 180.0
    private const val R2D = 180.0 / PI

    /** Great-circle distance in metres (haversine). */
    fun haversine(a: LatLon, b: LatLon): Double {
        val dLat = (b.lat - a.lat) * D2R
        val dLon = (b.lon - a.lon) * D2R
        val s = sin(dLat / 2).let { it * it } +
            cos(a.lat * D2R) * cos(b.lat * D2R) * sin(dLon / 2).let { it * it }
        return 2 * EARTH_R * asin(min(1.0, sqrt(s)))
    }

    /** Initial bearing a -> b, degrees clockwise from north [0, 360). */
    fun bearing(a: LatLon, b: LatLon): Double {
        val p1 = a.lat * D2R
        val p2 = b.lat * D2R
        val dl = (b.lon - a.lon) * D2R
        val y = sin(dl) * cos(p2)
        val x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dl)
        return (atan2(y, x) * R2D + 360) % 360
    }

    /** Smallest absolute angle between two bearings, [0, 180]. */
    fun bearingDiff(a: Double, b: Double): Double {
        val d = abs(a - b) % 360
        return if (d > 180) 360 - d else d
    }

    /** Signed relative bearing of target vs heading, (-180, 180]; negative = left. */
    fun relativeBearing(heading: Double, target: Double): Double {
        var d = (target - heading) % 360
        if (d > 180) d -= 360
        if (d <= -180) d += 360
        return d
    }

    /** Point reached travelling [dist] metres from [p] on bearing [brg]. */
    fun destination(p: LatLon, brg: Double, dist: Double): LatLon {
        val d = dist / EARTH_R
        val t = brg * D2R
        val p1 = p.lat * D2R
        val l1 = p.lon * D2R
        val p2 = asin(sin(p1) * cos(d) + cos(p1) * sin(d) * cos(t))
        val l2 = l1 + atan2(sin(t) * sin(d) * cos(p1), cos(d) - sin(p1) * sin(p2))
        return LatLon(p2 * R2D, ((l2 * R2D + 540) % 360) - 180)
    }

    /** Degrees of latitude / longitude spanned by a radius, for bbox prefilters. */
    fun radiusToDegrees(lat: Double, radiusM: Double): Pair<Double, Double> {
        val dLat = radiusM / 111320.0
        val dLon = radiusM / (111320.0 * max(0.01, cos(lat * D2R)))
        return dLat to dLon
    }

    /** Local equirectangular projection around [origin]: metres east (x), north (y). */
    fun toLocal(origin: LatLon, p: LatLon): Pair<Double, Double> {
        val x = (p.lon - origin.lon) * D2R * EARTH_R * cos(origin.lat * D2R)
        val y = (p.lat - origin.lat) * D2R * EARTH_R
        return x to y
    }

    data class PolylineHit(val distance: Double, val segIndex: Int, val t: Double, val alongM: Double)

    /** Distance from [p] to a polyline plus the along-line distance of the closest point. */
    fun distanceToPolyline(p: LatLon, line: List<LatLon>): PolylineHit {
        var best = PolylineHit(Double.POSITIVE_INFINITY, 0, 0.0, 0.0)
        var cum = 0.0
        for (i in 0 until line.size - 1) {
            val (ax, ay) = toLocal(p, line[i])
            val (bx, by) = toLocal(p, line[i + 1])
            val dx = bx - ax
            val dy = by - ay
            val len2 = dx * dx + dy * dy
            val segLen = sqrt(len2)
            var t = if (len2 == 0.0) 0.0 else -(ax * dx + ay * dy) / len2
            t = t.coerceIn(0.0, 1.0)
            val d = hypot(ax + t * dx, ay + t * dy)
            if (d < best.distance) best = PolylineHit(d, i, t, cum + t * segLen)
            cum += segLen
        }
        return best
    }

    private const val GH32 = "0123456789bcdefghjkmnpqrstuvwxyz"

    /** Standard geohash (identical cells to PostGIS ST_GeoHash). */
    fun geohash(lat: Double, lon: Double, precision: Int = 5): String {
        var latLo = -90.0; var latHi = 90.0
        var lonLo = -180.0; var lonHi = 180.0
        val sb = StringBuilder()
        var bit = 0; var ch = 0; var even = true
        while (sb.length < precision) {
            if (even) {
                val mid = (lonLo + lonHi) / 2
                if (lon >= mid) { ch = (ch shl 1) or 1; lonLo = mid } else { ch = ch shl 1; lonHi = mid }
            } else {
                val mid = (latLo + latHi) / 2
                if (lat >= mid) { ch = (ch shl 1) or 1; latLo = mid } else { ch = ch shl 1; latHi = mid }
            }
            even = !even
            if (++bit == 5) { sb.append(GH32[ch]); bit = 0; ch = 0 }
        }
        return sb.toString()
    }

    /** Geohash tiles covering a circle (home-region / rolling prefetch). */
    fun tilesAround(center: LatLon, radiusM: Double, precision: Int = 5): List<String> {
        val out = sortedSetOf<String>()
        val step = max(500.0, radiusM / 8)
        var dy = -radiusM
        while (dy <= radiusM) {
            var dx = -radiusM
            while (dx <= radiusM) {
                if (dx * dx + dy * dy <= radiusM * radiusM) {
                    val lat = center.lat + (dy / EARTH_R) * R2D
                    val lon = center.lon + (dx / (EARTH_R * cos(center.lat * D2R))) * R2D
                    out += geohash(lat, lon, precision)
                }
                dx += step
            }
            dy += step
        }
        return out.toList()
    }
}
