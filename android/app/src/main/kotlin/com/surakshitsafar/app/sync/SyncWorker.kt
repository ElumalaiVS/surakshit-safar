package com.surakshitsafar.app.sync

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.surakshitsafar.app.SafarApp
import com.surakshitsafar.app.data.HazardDb
import com.surakshitsafar.core.Geo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.time.OffsetDateTime
import java.util.concurrent.TimeUnit

/**
 * 1. Upload the outbox (reports, votes, pass reports, telemetry), idempotent by item id.
 * 2. Pull hazard deltas for pinned home tiles + tiles around the last known position.
 * 3. Evict tiles unused for 30 days.
 * Any network failure -> Result.retry() with exponential backoff; nothing is lost.
 */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val app = applicationContext as SafarApp
        val db = app.db
        val prefs = app.prefs
        val api = ApiClient(token = { prefs.authToken }, installId = prefs.installId)
        val now = System.currentTimeMillis()
        var failed = false

        // ---- 1. outbox
        try {
            while (true) {
                val batch = db.dueOutbox(now, 100)
                if (batch.isEmpty()) break
                val items = JSONArray()
                batch.forEach { items.put(JSONObject().put("id", it.id).put("kind", it.kind).put("payload", it.payload)) }
                val res = try {
                    api.post("/v1/outbox", JSONObject().put("items", items))
                } catch (e: IOException) {
                    db.backoffOutbox(batch.map { it.id }, now)
                    throw e
                }
                val done = res.optJSONArray("acked").toStrings() + res.optJSONArray("rejected").toStrings()
                db.deleteOutbox(done)
                // own reports are now server-side: drop their local placeholder rows
                db.deleteLocalHazards(batch.filter { it.kind == "report" && it.id in done }.map { it.id })
                val stuck = batch.map { it.id } - done.toSet()
                if (stuck.isNotEmpty()) { db.backoffOutbox(stuck, now); break }
            }
        } catch (e: IOException) {
            Log.w(TAG, "outbox upload failed: ${e.message}")
            failed = true
        }

        // ---- 2. hazard deltas
        try {
            val wanted = LinkedHashSet<String>()
            prefs.home?.let { home ->
                val homeTiles = Geo.tilesAround(home, HOME_RADIUS_M)
                db.ensureTiles(homeTiles, pinned = true)
            }
            wanted += db.pinnedTiles()
            prefs.lastKnown?.let { wanted += Geo.tilesAround(it, ROLLING_RADIUS_M) }
            db.ensureTiles(wanted, pinned = false)
            pullTiles(api, db, wanted.toList(), now)
            db.evictStaleTiles(now)
        } catch (e: IOException) {
            Log.w(TAG, "hazard sync failed: ${e.message}")
            failed = true
        }

        if (failed && runAttemptCount < 8) Result.retry() else Result.success()
    }

    private fun pullTiles(api: ApiClient, db: HazardDb, tiles: List<String>, now: Long) {
        for (chunk in tiles.chunked(50)) {
            val versions = db.tiles(chunk).associate { it.gh5 to it.lastVersion }.toMutableMap()
            var guard = 0
            do {
                val req = JSONArray()
                chunk.forEach { t -> req.put(JSONObject().put("gh5", t).put("since", versions[t] ?: 0L)) }
                val res = api.post("/v1/sync", JSONObject().put("tiles", req).put("limit", 5000))
                val rows = res.optJSONArray("rows") ?: JSONArray()
                val parsed = (0 until rows.length()).map { parseRow(rows.getJSONObject(it)) }
                val maxPerTile = db.applyServerRows(parsed)
                for (t in chunk) {
                    val v = maxOf(versions[t] ?: 0L, maxPerTile[t] ?: 0L)
                    versions[t] = v
                    db.markTileSynced(t, v, now)
                }
            } while (res.optBoolean("has_more", false) && ++guard < 20)
        }
    }

    private fun parseRow(o: JSONObject) = HazardDb.ServerRow(
        id = o.getString("hazard_id"),
        type = o.getString("hazard_type"),
        lat = o.getDouble("lat"),
        lon = o.getDouble("lon"),
        extentGeoJson = o.optStringOrNull("extent_geojson"),
        bearingDeg = if (o.isNull("bearing_deg")) null else o.optInt("bearing_deg"),
        severity = o.getString("severity"),
        status = o.getString("status"),
        trustTier = o.getInt("trust_tier"),
        confidence = o.getDouble("confidence"),
        expiresAtMs = o.optStringOrNull("expires_at")?.let { OffsetDateTime.parse(it).toInstant().toEpochMilli() },
        tile = o.getString("tile_gh5"),
        syncVersion = o.getLong("sync_version"),
        tombstone = o.optBoolean("tombstone", false),
    )

    private fun JSONObject.optStringOrNull(k: String): String? = if (isNull(k)) null else optString(k).ifBlank { null }

    private fun JSONArray?.toStrings(): List<String> =
        if (this == null) emptyList() else (0 until length()).map { getString(it) }

    companion object {
        private const val TAG = "SyncWorker"
        private const val HOME_RADIUS_M = 25_000.0
        private const val ROLLING_RADIUS_M = 10_000.0
        private const val PERIODIC = "safar-sync-periodic"
        private const val NOW = "safar-sync-now"

        private val netConstraint = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedulePeriodic(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<SyncWorker>(30, TimeUnit.MINUTES)
                .setConstraints(netConstraint)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        /** Sync as soon as there is network (duty start/stop, after a report). */
        fun syncSoon(ctx: Context) {
            val req = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(netConstraint)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, req)
        }
    }
}
