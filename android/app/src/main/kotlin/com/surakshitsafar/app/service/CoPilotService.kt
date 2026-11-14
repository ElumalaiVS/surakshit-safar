package com.surakshitsafar.app.service

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.surakshitsafar.app.R
import com.surakshitsafar.app.SafarApp
import com.surakshitsafar.app.cues.CueRenderer
import com.surakshitsafar.app.data.CachedHazardStore
import com.surakshitsafar.app.data.Reporter
import com.surakshitsafar.app.overlay.HazardOverlay
import com.surakshitsafar.app.sync.SyncWorker
import com.surakshitsafar.app.ui.MainActivity
import com.surakshitsafar.core.CoPilotEngine
import com.surakshitsafar.core.Cue
import com.surakshitsafar.core.CueKind
import com.surakshitsafar.core.Fix
import com.surakshitsafar.core.Geo
import com.surakshitsafar.core.HardBrakeDetector
import com.surakshitsafar.core.JoltDetector
import com.surakshitsafar.core.Lang
import com.surakshitsafar.core.LatLon
import com.surakshitsafar.core.RideContextProvider
import com.surakshitsafar.core.Taxonomy

/**
 * The co-pilot. A location-type foreground service so alerts keep working while the
 * rider has Rapido / Uber / Ola / Swiggy / Maps on screen.
 *
 * Threading: location callbacks, sensor callbacks and the engine all run on ONE
 * HandlerThread ("copilot"), so the engine needs no locks. Overlay/TTS hop to main.
 *
 * Battery: GPS 1 Hz while moving, 5 s after 2 min stationary; accelerometer at 50 Hz
 * only above 12 km/h and only with telemetry consent.
 */
class CoPilotService : Service(), SensorEventListener {

    private lateinit var app: SafarApp
    private lateinit var thread: HandlerThread
    private lateinit var handler: Handler
    private lateinit var engine: CoPilotEngine
    private lateinit var renderer: CueRenderer
    private lateinit var overlay: HazardOverlay
    private lateinit var fused: FusedLocationProviderClient
    private lateinit var sensors: SensorManager
    private lateinit var contextProvider: RideContextProvider

    private val jolt = JoltDetector()
    private val brake = HardBrakeDetector()
    private var accel: Sensor? = null

    // engine-thread state (running is also read from the main thread)
    @Volatile private var running = false
    private var accelOn = false
    private var slowSinceMs: Long? = null
    private var stoppedSinceMs: Long? = null
    private var highRate = true
    private var lastFix: Fix? = null
    private var lastSavedPosMs = 0L

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            result.lastLocation?.let(::onLocation)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        app = application as SafarApp
        thread = HandlerThread("copilot").apply { start() }
        handler = Handler(thread.looper)
        engine = CoPilotEngine(CachedHazardStore(app.db), app.prefs.engineConfig())
        renderer = CueRenderer(this) { missing ->
            // Device lacks a Telugu/Hindi voice: speak English rather than garble the text
            handler.post { engine.updateConfig { it.copy(lang = Lang.EN) } }
            RideState.update { it.copy(ttsMissing = missing) }
        }
        renderer.setLanguage(app.prefs.lang)
        overlay = HazardOverlay(this)
        fused = LocationServices.getFusedLocationProviderClient(this)
        sensors = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        accel = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        contextProvider = RideContextProvider(raining = { app.prefs.raining })
        handler.post { engine.loadFamiliarity(app.db.loadFamiliarity()) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        if (action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        // Control actions only make sense while on duty; never let them start a bare service.
        if (action != null && action != ACTION_START && !running) {
            stopSelf()
            return START_NOT_STICKY
        }
        when (action) {
            ACTION_TOGGLE_RAIN -> {
                app.prefs.raining = !app.prefs.raining
                postNotification(null)
                return START_NOT_STICKY
            }
            ACTION_RELOAD_CONFIG -> {
                val cfg = app.prefs.engineConfig()
                handler.post { engine.updateConfig { cfg.copy(route = it.route) } }
                renderer.setLanguage(cfg.lang)
                RideState.update { it.copy(ttsMissing = null) }
                return START_NOT_STICKY
            }
        }

        // ACTION_START (or null)
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "No location permission; not starting")
            stopSelf()
            return START_NOT_STICKY
        }
        ServiceCompat.startForeground(
            this, NOTIF_ID, buildNotification(null),
            if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0,
        )
        if (!running) {
            running = true
            requestLocation(highRate = true)
            RideState.update { it.copy(running = true) }
            SyncWorker.syncSoon(this)
        }
        // Not sticky: a restart from the background could not get "while in use" location anyway.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        fused.removeLocationUpdates(locationCallback)
        sensors.unregisterListener(this)
        overlay.hide()
        renderer.release()
        handler.post {
            val now = System.currentTimeMillis()
            engine.familiaritySnapshot().forEach { (id, f) -> app.db.saveFamiliarity(id, f, now) }
        }
        thread.quitSafely()
        RideState.update { it.copy(running = false, stoppedSinceMs = null) }
        SyncWorker.syncSoon(this)
        super.onDestroy()
    }

    // ------------------------------------------------------------- location

    private fun requestLocation(highRate: Boolean) {
        this.highRate = highRate
        val interval = if (highRate) 1000L else 5000L
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, interval)
            .setMinUpdateIntervalMillis(interval / 2)
            .setWaitForAccurateLocation(false)
            .build()
        try {
            fused.removeLocationUpdates(locationCallback)
            fused.requestLocationUpdates(req, locationCallback, thread.looper)
        } catch (e: SecurityException) {
            Log.e(TAG, "location permission revoked", e)
            stopSelf()
        }
    }

    /** Runs on the copilot thread. */
    private fun onLocation(loc: Location) {
        if (!running) return
        val now = System.currentTimeMillis()
        val fix = Fix(
            lat = loc.latitude,
            lon = loc.longitude,
            speedMps = if (loc.hasSpeed()) loc.speed.toDouble() else 0.0,
            headingDeg = if (loc.hasBearing()) loc.bearing.toDouble() else null,
            accuracyM = if (loc.hasAccuracy()) loc.accuracy.toDouble() else 50.0,
            tMs = now,
        )
        lastFix = fix
        val kmh = fix.speedMps * 3.6

        val result = engine.update(fix, contextProvider.at(now, fix.lat, fix.lon))

        for (cue in result.cues) {
            renderer.play(cue)
            // praise is voice-only; everything else gets a brief bubble
            if (cue.kind != CueKind.SPEED_PRAISE) overlay.showCue(cue, shortLabel(cue))
        }
        // The notification stays static on purpose: updating it per cue would add yet
        // another channel competing for attention (and a status-bar flicker on some OEMs).

        for (p in result.passes) {
            engine.familiarityOf(p.hazardId)?.let { app.db.saveFamiliarity(p.hazardId, it, now) }
            // Physics check of an agency's "fixed" claim: anonymous pass report
            if (p.status == "resolved_pending_check" && app.prefs.telemetryConsent && !p.hazardId.startsWith("local:")) {
                app.db.enqueue("pass", Reporter.passPayload(p.hazardId, p.jolted))
            }
        }

        brake.push(now, fix.speedMps)?.let { ev ->
            emitTelemetry("hard_brake", fix.point, fix, ev.decelG, now - ev.tMs, ev.tMs)
        }

        gateSensors(kmh, now)
        adaptRate(fix.speedMps, now)

        stoppedSinceMs = if (fix.speedMps < RideSnapshot.STOPPED_MPS) (stoppedSinceMs ?: now) else null
        if (now - lastSavedPosMs > 60_000) {
            app.prefs.lastKnown = fix.point
            lastSavedPosMs = now
        }
        val cueText = result.cues.firstOrNull { it.kind != CueKind.SPEED_PRAISE }?.let {
            if (it.speedKmh != null) "${shortLabel(it)} · ${it.speedKmh} km/h" else "${shortLabel(it)} · ${it.distanceM} m"
        }
        RideState.update {
            it.copy(fix = fix, stoppedSinceMs = stoppedSinceMs, lastCueText = cueText ?: it.lastCueText)
        }
    }

    private fun adaptRate(speedMps: Double, now: Long) {
        if (speedMps < 1.0) {
            if (slowSinceMs == null) slowSinceMs = now
            if (highRate && now - (slowSinceMs ?: now) > 120_000) requestLocation(highRate = false)
        } else {
            slowSinceMs = null
            if (!highRate && speedMps > 2.0) requestLocation(highRate = true)
        }
    }

    // --------------------------------------------------------------- sensors

    private fun gateSensors(kmh: Double, now: Long) {
        val sensor = accel ?: return
        val want = app.prefs.telemetryConsent && kmh >= 12
        if (want && !accelOn) {
            accelOn = sensors.registerListener(this, sensor, 20_000, handler)   // 50 Hz, on copilot thread
        } else if (!want && accelOn && (kmh < 8 || !app.prefs.telemetryConsent)) {
            sensors.unregisterListener(this)
            accelOn = false
        }
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_ACCELEROMETER) return
        val fix = lastFix ?: return
        // sensor timestamps are elapsed-realtime nanos; convert to wall clock to match fixes
        val wallMs = System.currentTimeMillis() - (SystemClock.elapsedRealtimeNanos() - event.timestamp) / 1_000_000
        val ev = jolt.push(wallMs, event.values[0].toDouble(), event.values[1].toDouble(),
            event.values[2].toDouble(), fix.speedMps * 3.6) ?: return
        // dead-reckon from the last fix to the moment of impact (fix is up to 1 s old)
        val dt = (ev.tMs - fix.tMs).coerceIn(-1500L, 1500L) / 1000.0
        val at = fix.headingDeg?.let { Geo.destination(fix.point, it, fix.speedMps * dt) } ?: fix.point
        engine.noteJolt(ev.tMs, at.lat, at.lon)
        emitTelemetry(ev.kind.wire, at, fix, ev.peakG, ev.durationMs, ev.tMs)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    /** Privacy-filtered telemetry into the outbox. */
    private fun emitTelemetry(kind: String, at: LatLon, fix: Fix, peakG: Double, durationMs: Long, tMs: Long) {
        if (!app.prefs.telemetryConsent) return
        if (fix.accuracyM > 20) return                                     // too fuzzy to cluster at 12 m
        app.prefs.home?.let { if (Geo.haversine(it, at) < PRIVACY_ZONE_M) return }
        app.db.enqueue("telemetry", Reporter.telemetryPayload(
            kind, at.lat, at.lon, fix.headingDeg, fix.speedMps * 3.6, peakG, durationMs,
            app.prefs.vehicle, tMs, app.prefs.weeklyPseudonym()))
    }

    // ---------------------------------------------------------- notification

    private fun shortLabel(cue: Cue): String {
        val lang = engine.config.lang
        if (cue.kind == CueKind.SPEED_NUDGE && cue.hazardType == "speed") return SPEED_WORD.getValue(lang)
        return Taxonomy[cue.hazardType]?.label?.get(lang)?.substringBefore(',') ?: cue.hazardType
    }

    private fun postNotification(cue: Cue?) {
        getSystemService(NotificationManager::class.java).notify(NOTIF_ID, buildNotification(cue))
    }

    private fun buildNotification(cue: Cue?): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 1, Intent(this, CoPilotService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE)
        val rain = PendingIntent.getService(this, 2, Intent(this, CoPilotService::class.java).setAction(ACTION_TOGGLE_RAIN),
            PendingIntent.FLAG_IMMUTABLE)
        val text = cue?.let { getString(R.string.notif_next, shortLabel(it), "${it.distanceM} m") }
            ?: getString(R.string.notif_on_duty)
        return NotificationCompat.Builder(this, SafarApp.CHANNEL_DUTY)
            .setSmallIcon(R.drawable.ic_stat_safar)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(open)
            .addAction(0, getString(if (app.prefs.raining) R.string.action_rain_off else R.string.action_rain_on), rain)
            .addAction(0, getString(R.string.action_stop), stop)
            .build()
    }

    companion object {
        private const val TAG = "CoPilotService"
        private const val NOTIF_ID = 42
        private const val PRIVACY_ZONE_M = 300.0
        private val SPEED_WORD = mapOf(Lang.EN to "Speed", Lang.TE to "వేగం", Lang.HI to "रफ़्तार", Lang.TA to "வேகம்")

        const val ACTION_START = "com.surakshitsafar.START"
        const val ACTION_STOP = "com.surakshitsafar.STOP"
        const val ACTION_TOGGLE_RAIN = "com.surakshitsafar.TOGGLE_RAIN"
        const val ACTION_RELOAD_CONFIG = "com.surakshitsafar.RELOAD_CONFIG"

        fun start(ctx: Context) =
            ContextCompat.startForegroundService(ctx, Intent(ctx, CoPilotService::class.java).setAction(ACTION_START))

        fun stop(ctx: Context) = ctx.startService(Intent(ctx, CoPilotService::class.java).setAction(ACTION_STOP))

        /** Only valid while running (the service is already in the foreground). */
        fun send(ctx: Context, action: String) = ctx.startService(Intent(ctx, CoPilotService::class.java).setAction(action))
    }
}
