package com.surakshitsafar.app.data

import android.content.Context
import com.surakshitsafar.app.SafarApp
import com.surakshitsafar.app.sync.SyncWorker
import com.surakshitsafar.core.Fix
import com.surakshitsafar.core.Persistence
import com.surakshitsafar.core.Taxonomy
import com.surakshitsafar.core.VehicleClass
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

/** Builds outbox payloads. Shapes match the server API contract in README_ANDROID.md. */
object Reporter {

    /**
     * Rider reports a hazard where they are stopped. Queued offline, shown locally at once,
     * uploaded on next sync (idempotent: the outbox id is the server's report id).
     */
    fun reportHazard(context: Context, type: String, fix: Fix, note: String? = null): String {
        val app = context.applicationContext as SafarApp
        val meta = requireNotNull(Taxonomy[type]) { "unknown hazard type $type" }
        val id = UUID.randomUUID().toString()
        val payload = JSONObject()
            .put("hazard_type", type)
            .put("lat", fix.lat)
            .put("lon", fix.lon)
            .put("heading_deg", fix.headingDeg?.toInt() ?: JSONObject.NULL)
            .put("speed_kmh", fix.speedMps * 3.6)
            .put("accuracy_m", fix.accuracyM)
            .put("reported_at", Instant.ofEpochMilli(fix.tMs).toString())
            .put("note", note ?: JSONObject.NULL)
        app.db.enqueue("report", payload, id)

        val ttlMs = when (meta.persistence) {
            Persistence.TRANSIENT -> 12L * 3600 * 1000
            Persistence.SEMI -> 30L * 24 * 3600 * 1000
            else -> null
        }
        app.db.insertLocalHazard(
            reportId = id, type = type, at = fix.point, severity = meta.severity,
            bearingDeg = if (meta.directional) fix.headingDeg?.toInt() else null,
            expiresAtMs = ttlMs?.let { fix.tMs + it },
        )
        SyncWorker.syncSoon(context)
        return id
    }

    fun passPayload(hazardId: String, jolted: Boolean): JSONObject =
        JSONObject().put("hazard_id", hazardId).put("jolted", jolted)

    fun votePayload(hazardId: String, vote: String, fix: Fix): JSONObject =
        JSONObject().put("hazard_id", hazardId).put("vote", vote).put("lat", fix.lat).put("lon", fix.lon)

    fun telemetryPayload(kind: String, lat: Double, lon: Double, headingDeg: Double?, speedKmh: Double,
                         peakG: Double, durationMs: Long, vehicle: VehicleClass, recordedAtMs: Long,
                         pseudonym: String): JSONObject =
        JSONObject()
            .put("kind", kind)
            .put("lat", lat).put("lon", lon)
            .put("heading_deg", headingDeg?.toInt() ?: JSONObject.NULL)
            .put("speed_kmh", speedKmh)
            .put("peak_g", peakG)
            .put("duration_ms", durationMs)
            .put("vehicle_class", vehicle.wire)
            .put("recorded_at", Instant.ofEpochMilli(recordedAtMs).toString())
            .put("device_pseudonym", pseudonym)

    private val VehicleClass.wire: String get() = when (this) {
        VehicleClass.TWO_WHEELER -> "2w"
        VehicleClass.THREE_WHEELER -> "3w"
        VehicleClass.CAR -> "car"
        VehicleClass.BUS -> "bus"
        VehicleClass.TRUCK -> "truck"
    }
}
