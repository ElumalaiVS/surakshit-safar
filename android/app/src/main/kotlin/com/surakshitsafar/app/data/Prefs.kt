package com.surakshitsafar.app.data

import android.content.Context
import androidx.core.content.edit
import com.surakshitsafar.core.EngineConfig
import com.surakshitsafar.core.Lang
import com.surakshitsafar.core.LatLon
import com.surakshitsafar.core.RiderMode
import com.surakshitsafar.core.VehicleClass
import java.security.MessageDigest
import java.time.LocalDate
import java.time.temporal.IsoFields
import java.util.UUID

/** Rider settings. Small and synchronous: read on the service thread, written from the UI. */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("safar_prefs", Context.MODE_PRIVATE)

    var vehicle: VehicleClass
        get() = enumOr(sp.getString(K_VEHICLE, null), VehicleClass.TWO_WHEELER)
        set(v) = sp.edit { putString(K_VEHICLE, v.name) }

    var mode: RiderMode
        get() = enumOr(sp.getString(K_MODE, null), RiderMode.STANDARD)
        set(v) = sp.edit { putString(K_MODE, v.name) }

    var lang: Lang
        get() = enumOr(sp.getString(K_LANG, null), Lang.TE)
        set(v) = sp.edit { putString(K_LANG, v.name) }

    /** Playful lines for speed nudges (hazard warnings are always plain). */
    var funMode: Boolean
        get() = sp.getBoolean(K_FUN, true)
        set(v) = sp.edit { putBoolean(K_FUN, v) }

    var raining: Boolean
        get() = sp.getBoolean(K_RAIN, false)
        set(v) = sp.edit { putBoolean(K_RAIN, v) }

    /** Separate, explicit consent for passive telemetry (DPDP Act): off until the rider opts in. */
    var telemetryConsent: Boolean
        get() = sp.getBoolean(K_TELEMETRY, false)
        set(v) = sp.edit { putBoolean(K_TELEMETRY, v) }

    /** Home point: privacy zone for telemetry + pinned offline region. */
    var home: LatLon?
        get() = if (sp.contains(K_HOME_LAT)) LatLon(
            Double.fromBits(sp.getLong(K_HOME_LAT, 0)), Double.fromBits(sp.getLong(K_HOME_LON, 0))) else null
        set(v) = sp.edit {
            if (v == null) { remove(K_HOME_LAT); remove(K_HOME_LON) }
            else { putLong(K_HOME_LAT, v.lat.toRawBits()); putLong(K_HOME_LON, v.lon.toRawBits()) }
        }

    /** Last position seen by the service: lets the sync worker prefetch around the rider. */
    var lastKnown: LatLon?
        get() = if (sp.contains(K_LAST_LAT)) LatLon(
            Double.fromBits(sp.getLong(K_LAST_LAT, 0)), Double.fromBits(sp.getLong(K_LAST_LON, 0))) else null
        set(v) = sp.edit {
            if (v != null) { putLong(K_LAST_LAT, v.lat.toRawBits()); putLong(K_LAST_LON, v.lon.toRawBits()) }
        }

    /** Bearer token from phone-OTP sign-in (auth flow is server-side work; empty = anonymous). */
    var authToken: String
        get() = sp.getString(K_TOKEN, "") ?: ""
        set(v) = sp.edit { putString(K_TOKEN, v) }

    val installId: String
        get() = sp.getString(K_INSTALL, null) ?: UUID.randomUUID().toString().also { id ->
            sp.edit { putString(K_INSTALL, id) }
        }

    /**
     * Anonymous telemetry pseudonym that rotates every ISO week, so server-side
     * events cannot be stitched into long-term movement histories.
     */
    fun weeklyPseudonym(today: LocalDate = LocalDate.now()): String {
        val week = "${today.get(IsoFields.WEEK_BASED_YEAR)}-W${today.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR)}"
        val digest = MessageDigest.getInstance("SHA-256").digest("$installId|$week".toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }

    fun engineConfig(): EngineConfig = EngineConfig(vehicle = vehicle, mode = mode, lang = lang, funMode = funMode)

    private inline fun <reified E : Enum<E>> enumOr(name: String?, default: E): E =
        name?.let { n -> enumValues<E>().firstOrNull { it.name == n } } ?: default

    private companion object {
        const val K_VEHICLE = "vehicle"
        const val K_MODE = "mode"
        const val K_LANG = "lang"
        const val K_RAIN = "raining"
        const val K_FUN = "fun_mode"
        const val K_TELEMETRY = "telemetry_consent"
        const val K_HOME_LAT = "home_lat"
        const val K_HOME_LON = "home_lon"
        const val K_LAST_LAT = "last_lat"
        const val K_LAST_LON = "last_lon"
        const val K_TOKEN = "auth_token"
        const val K_INSTALL = "install_id"
    }
}
