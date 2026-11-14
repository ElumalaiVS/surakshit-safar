package com.surakshitsafar.app.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.surakshitsafar.core.CoPilotEngine
import com.surakshitsafar.core.Geo
import com.surakshitsafar.core.Hazard
import com.surakshitsafar.core.LatLon
import com.surakshitsafar.core.Severity
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

/**
 * Offline cache on the phone (mirrors edge/sql/edge_schema.sql).
 *
 * Android's platform SQLite is not guaranteed to ship R*Tree on every OEM build, so the
 * spatial prefilter here is a bounding-box overlap on indexed min/max columns. With the
 * few thousand hazards in a 25 km home region this answers in well under a millisecond;
 * swap in requery/sqlite-android + R*Tree if a region ever holds hundreds of thousands.
 *
 * Works on API 26 (SQLite 3.18): no UPSERT syntax, version checks done in code.
 */
class HazardDb(context: Context) : SQLiteOpenHelper(context, "safar.db", null, 1) {

    /** Bumped on every hazard change so in-memory caches know to refresh. */
    val changeCounter = AtomicLong(0)

    override fun onConfigure(db: SQLiteDatabase) {
        db.enableWriteAheadLogging()   // 1 Hz alert reads never block sync writes
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE hazards (
              id            TEXT PRIMARY KEY,
              hazard_type   TEXT NOT NULL,
              lat           REAL NOT NULL,
              lon           REAL NOT NULL,
              extent_json   TEXT,
              bearing_deg   INTEGER,
              severity      TEXT NOT NULL,
              status        TEXT NOT NULL,
              trust_tier    INTEGER NOT NULL,
              confidence    REAL NOT NULL,
              expires_at_ms INTEGER,
              tile_gh5      TEXT NOT NULL,
              sync_version  INTEGER NOT NULL,
              local_only    INTEGER NOT NULL DEFAULT 0,
              min_lat REAL NOT NULL, max_lat REAL NOT NULL,
              min_lon REAL NOT NULL, max_lon REAL NOT NULL
            )""".trimIndent())
        db.execSQL("CREATE INDEX hazards_bbox_idx ON hazards (min_lat, max_lat)")
        db.execSQL("CREATE INDEX hazards_tile_idx ON hazards (tile_gh5)")
        db.execSQL("""
            CREATE TABLE tiles (
              gh5               TEXT PRIMARY KEY,
              last_sync_version INTEGER NOT NULL DEFAULT 0,
              fetched_at_ms     INTEGER NOT NULL DEFAULT 0,
              pinned            INTEGER NOT NULL DEFAULT 0
            )""".trimIndent())
        db.execSQL("""
            CREATE TABLE outbox (
              id              TEXT PRIMARY KEY,
              kind            TEXT NOT NULL,
              payload_json    TEXT NOT NULL,
              created_at_ms   INTEGER NOT NULL,
              attempts        INTEGER NOT NULL DEFAULT 0,
              next_attempt_ms INTEGER NOT NULL DEFAULT 0
            )""".trimIndent())
        db.execSQL("CREATE INDEX outbox_due_idx ON outbox (next_attempt_ms)")
        db.execSQL("""
            CREATE TABLE familiarity (
              hazard_id    TEXT PRIMARY KEY,
              safe_passes  INTEGER NOT NULL DEFAULT 0,
              rough_passes INTEGER NOT NULL DEFAULT 0,
              last_pass_ms INTEGER NOT NULL
            )""".trimIndent())
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // v1 only. Future migrations go here; never drop outbox (unsent reports).
    }

    // --------------------------------------------------------------- hazards

    /** Hazards whose bbox overlaps the circle and have not expired. */
    fun queryHazards(center: LatLon, radiusM: Double, nowMs: Long): List<Hazard> {
        val (dLat, dLon) = Geo.radiusToDegrees(center.lat, radiusM)
        val out = ArrayList<Hazard>()
        readableDatabase.rawQuery(
            """SELECT id, hazard_type, lat, lon, extent_json, bearing_deg, severity, status,
                      trust_tier, confidence, expires_at_ms
                 FROM hazards
                WHERE min_lat <= ? AND max_lat >= ? AND min_lon <= ? AND max_lon >= ?
                  AND (expires_at_ms IS NULL OR expires_at_ms > ?)""",
            arrayOf(
                (center.lat + dLat).toString(), (center.lat - dLat).toString(),
                (center.lon + dLon).toString(), (center.lon - dLon).toString(), nowMs.toString(),
            ),
        ).use { c ->
            while (c.moveToNext()) {
                out += Hazard(
                    id = c.getString(0),
                    type = c.getString(1),
                    lat = c.getDouble(2),
                    lon = c.getDouble(3),
                    extent = if (c.isNull(4)) null else parseLineString(c.getString(4)),
                    bearingDeg = if (c.isNull(5)) null else c.getInt(5),
                    severity = Severity.parse(c.getString(6)),
                    status = c.getString(7),
                    trustTier = c.getInt(8),
                    confidence = c.getDouble(9),
                    expiresAtMs = if (c.isNull(10)) null else c.getLong(10),
                )
            }
        }
        return out
    }

    /** One row from the server's fn_sync_delta (see README_ANDROID.md for the JSON contract). */
    data class ServerRow(
        val id: String, val type: String, val lat: Double, val lon: Double, val extentGeoJson: String?,
        val bearingDeg: Int?, val severity: String, val status: String, val trustTier: Int,
        val confidence: Double, val expiresAtMs: Long?, val tile: String, val syncVersion: Long,
        val tombstone: Boolean,
    )

    /** Apply a sync page atomically. Returns the highest version seen per tile. */
    fun applyServerRows(rows: List<ServerRow>): Map<String, Long> {
        val maxPerTile = HashMap<String, Long>()
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (r in rows) {
                maxPerTile[r.tile] = maxOf(maxPerTile[r.tile] ?: 0L, r.syncVersion)
                if (r.tombstone) {
                    db.delete("hazards", "id = ?", arrayOf(r.id))
                    continue
                }
                val existing = db.rawQuery("SELECT sync_version FROM hazards WHERE id = ?", arrayOf(r.id))
                    .use { if (it.moveToFirst()) it.getLong(0) else null }
                if (existing != null && existing >= r.syncVersion) continue

                val extent = r.extentGeoJson?.let { geoJsonToLine(it) }
                val lats = (extent?.map { it.lat } ?: emptyList()) + r.lat
                val lons = (extent?.map { it.lon } ?: emptyList()) + r.lon
                val cv = ContentValues().apply {
                    put("id", r.id); put("hazard_type", r.type); put("lat", r.lat); put("lon", r.lon)
                    put("extent_json", extent?.let { lineToJson(it) })
                    if (r.bearingDeg != null) put("bearing_deg", r.bearingDeg) else putNull("bearing_deg")
                    put("severity", r.severity); put("status", r.status); put("trust_tier", r.trustTier)
                    put("confidence", r.confidence)
                    if (r.expiresAtMs != null) put("expires_at_ms", r.expiresAtMs) else putNull("expires_at_ms")
                    put("tile_gh5", r.tile); put("sync_version", r.syncVersion); put("local_only", 0)
                    put("min_lat", lats.min()); put("max_lat", lats.max())
                    put("min_lon", lons.min()); put("max_lon", lons.max())
                }
                db.insertWithOnConflict("hazards", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        changeCounter.incrementAndGet()
        return maxPerTile
    }

    /**
     * The rider's own report, shown immediately (offline) until the server copy arrives.
     * Local rows are removed once the report is acknowledged and a sync has run.
     */
    fun insertLocalHazard(reportId: String, type: String, at: LatLon, severity: Severity, bearingDeg: Int?,
                          expiresAtMs: Long?) {
        val cv = ContentValues().apply {
            put("id", "local:$reportId"); put("hazard_type", type); put("lat", at.lat); put("lon", at.lon)
            putNull("extent_json")
            if (bearingDeg != null) put("bearing_deg", bearingDeg) else putNull("bearing_deg")
            put("severity", severity.name.lowercase()); put("status", "candidate"); put("trust_tier", 2)
            put("confidence", 0.6)   // the rider saw it: alert them, but as a normal (non-tentative) cue
            if (expiresAtMs != null) put("expires_at_ms", expiresAtMs) else putNull("expires_at_ms")
            put("tile_gh5", Geo.geohash(at.lat, at.lon, 5)); put("sync_version", 0); put("local_only", 1)
            put("min_lat", at.lat); put("max_lat", at.lat); put("min_lon", at.lon); put("max_lon", at.lon)
        }
        writableDatabase.insertWithOnConflict("hazards", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
        changeCounter.incrementAndGet()
    }

    fun deleteLocalHazards(reportIds: Collection<String>) {
        if (reportIds.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try {
            reportIds.forEach { db.delete("hazards", "id = ?", arrayOf("local:$it")) }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
        changeCounter.incrementAndGet()
    }

    // ----------------------------------------------------------------- tiles

    data class TileState(val gh5: String, val lastVersion: Long, val pinned: Boolean)

    fun ensureTiles(tiles: Collection<String>, pinned: Boolean) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (t in tiles) {
                db.execSQL("INSERT OR IGNORE INTO tiles (gh5, last_sync_version, fetched_at_ms, pinned) VALUES (?, 0, 0, ?)",
                    arrayOf<Any>(t, if (pinned) 1 else 0))
                if (pinned) db.execSQL("UPDATE tiles SET pinned = 1 WHERE gh5 = ?", arrayOf<Any>(t))
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    fun tiles(names: Collection<String>): List<TileState> {
        if (names.isEmpty()) return emptyList()
        val out = ArrayList<TileState>()
        names.chunked(500).forEach { chunk ->
            val qs = chunk.joinToString(",") { "?" }
            readableDatabase.rawQuery("SELECT gh5, last_sync_version, pinned FROM tiles WHERE gh5 IN ($qs)",
                chunk.toTypedArray()).use { c ->
                while (c.moveToNext()) out += TileState(c.getString(0), c.getLong(1), c.getInt(2) == 1)
            }
        }
        return out
    }

    fun pinnedTiles(): List<String> = readableDatabase.rawQuery("SELECT gh5 FROM tiles WHERE pinned = 1", null)
        .use { c -> buildList { while (c.moveToNext()) add(c.getString(0)) } }

    fun markTileSynced(gh5: String, version: Long, nowMs: Long) {
        writableDatabase.execSQL(
            "UPDATE tiles SET last_sync_version = MAX(last_sync_version, ?), fetched_at_ms = ? WHERE gh5 = ?",
            arrayOf<Any>(version, nowMs, gh5))
    }

    /** Drop hazards in unpinned tiles untouched for 30 days. */
    fun evictStaleTiles(nowMs: Long) {
        val cutoff = nowMs - 30L * 24 * 3600 * 1000
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.execSQL("DELETE FROM hazards WHERE local_only = 0 AND tile_gh5 IN " +
                "(SELECT gh5 FROM tiles WHERE pinned = 0 AND fetched_at_ms < ?)", arrayOf<Any>(cutoff))
            db.execSQL("DELETE FROM tiles WHERE pinned = 0 AND fetched_at_ms < ?", arrayOf<Any>(cutoff))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
        changeCounter.incrementAndGet()
    }

    // ---------------------------------------------------------------- outbox

    data class OutboxItem(val id: String, val kind: String, val payload: JSONObject, val attempts: Int)

    /** Enqueue for upload. The id doubles as the server idempotency key. */
    fun enqueue(kind: String, payload: JSONObject, id: String = UUID.randomUUID().toString()): String {
        val cv = ContentValues().apply {
            put("id", id); put("kind", kind); put("payload_json", payload.toString())
            put("created_at_ms", System.currentTimeMillis()); put("attempts", 0); put("next_attempt_ms", 0)
        }
        writableDatabase.insertWithOnConflict("outbox", null, cv, SQLiteDatabase.CONFLICT_IGNORE)
        return id
    }

    fun dueOutbox(nowMs: Long, limit: Int = 100): List<OutboxItem> =
        readableDatabase.rawQuery(
            "SELECT id, kind, payload_json, attempts FROM outbox WHERE next_attempt_ms <= ? ORDER BY created_at_ms LIMIT ?",
            arrayOf(nowMs.toString(), limit.toString()),
        ).use { c ->
            buildList { while (c.moveToNext()) add(OutboxItem(c.getString(0), c.getString(1), JSONObject(c.getString(2)), c.getInt(3))) }
        }

    fun deleteOutbox(ids: Collection<String>) {
        if (ids.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try {
            ids.forEach { db.delete("outbox", "id = ?", arrayOf(it)) }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    /** Exponential backoff: 30 s, 1 min, 2 min ... capped at 6 h. */
    fun backoffOutbox(ids: Collection<String>, nowMs: Long) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (id in ids) {
                db.execSQL("""UPDATE outbox SET attempts = attempts + 1,
                               next_attempt_ms = ? + MIN(21600000, 30000 * (1 << MIN(attempts, 10)))
                             WHERE id = ?""", arrayOf<Any>(nowMs, id))
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    fun outboxCount(): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM outbox", null)
        .use { if (it.moveToFirst()) it.getInt(0) else 0 }

    // ----------------------------------------------------------- familiarity

    fun loadFamiliarity(): Map<String, CoPilotEngine.Familiarity> =
        readableDatabase.rawQuery("SELECT hazard_id, safe_passes, rough_passes FROM familiarity", null).use { c ->
            buildMap { while (c.moveToNext()) put(c.getString(0), CoPilotEngine.Familiarity(c.getInt(1), c.getInt(2))) }
        }

    fun saveFamiliarity(hazardId: String, f: CoPilotEngine.Familiarity, nowMs: Long) {
        val cv = ContentValues().apply {
            put("hazard_id", hazardId); put("safe_passes", f.safe); put("rough_passes", f.rough); put("last_pass_ms", nowMs)
        }
        writableDatabase.insertWithOnConflict("familiarity", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
    }

    // --------------------------------------------------------------- helpers

    private fun geoJsonToLine(geoJson: String): List<LatLon>? = runCatching {
        val coords = JSONObject(geoJson).getJSONArray("coordinates")
        (0 until coords.length()).map { i -> coords.getJSONArray(i).let { LatLon(it.getDouble(1), it.getDouble(0)) } }
    }.getOrNull()?.takeIf { it.size >= 2 }

    private fun lineToJson(line: List<LatLon>): String =
        JSONArray().apply { line.forEach { put(JSONArray().put(it.lat).put(it.lon)) } }.toString()

    private fun parseLineString(json: String): List<LatLon>? = runCatching {
        val a = JSONArray(json)
        (0 until a.length()).map { i -> a.getJSONArray(i).let { LatLon(it.getDouble(0), it.getDouble(1)) } }
    }.getOrNull()?.takeIf { it.size >= 2 }
}
