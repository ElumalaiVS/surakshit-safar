package com.surakshitsafar.app.data

import com.surakshitsafar.core.Geo
import com.surakshitsafar.core.Hazard
import com.surakshitsafar.core.HazardStore
import com.surakshitsafar.core.LatLon

/**
 * Keeps a ~2.5 km working set in memory so the 1 Hz engine loop never touches disk.
 * Refreshes when the rider nears the edge of the cached circle, every 30 s, or as soon
 * as sync / a local report changes the database.
 */
class CachedHazardStore(private val db: HazardDb) : HazardStore {

    private var center: LatLon? = null
    private var radius = 0.0
    private var fetchedAtMs = 0L
    private var seenChange = -1L
    private var cached: List<Hazard> = emptyList()

    override fun query(center: LatLon, radiusM: Double, nowMs: Long): List<Hazard> {
        val c = this.center
        val stale = c == null ||
            Geo.haversine(c, center) + radiusM > radius ||
            nowMs - fetchedAtMs > 30_000 ||
            db.changeCounter.get() != seenChange
        if (stale) {
            val r = maxOf(radiusM * 3, 2500.0)
            seenChange = db.changeCounter.get()
            cached = db.queryHazards(center, r, nowMs)
            this.center = center
            radius = r
            fetchedAtMs = nowMs
        }
        return cached.filter { h ->
            val ext = h.extent
            if (ext != null) Geo.distanceToPolyline(center, ext).distance <= radiusM
            else Geo.haversine(center, h.point) <= radiusM
        }
    }
}
