package com.surakshitsafar.app.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.surakshitsafar.app.R
import com.surakshitsafar.app.SafarApp
import com.surakshitsafar.app.cues.CueRenderer
import com.surakshitsafar.app.data.Reporter
import com.surakshitsafar.app.service.CoPilotService
import com.surakshitsafar.app.service.RideState
import com.surakshitsafar.core.CoPilotEngine
import com.surakshitsafar.core.Cue
import com.surakshitsafar.core.CueKind
import com.surakshitsafar.core.Earcon
import com.surakshitsafar.core.Haptics
import com.surakshitsafar.core.Lang
import com.surakshitsafar.core.LatLon
import com.surakshitsafar.core.RiderMode
import com.surakshitsafar.core.Severity
import com.surakshitsafar.core.Taxonomy
import com.surakshitsafar.core.VehicleClass
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val Amber = Color(0xFFFFB300)
private val Green = Color(0xFF2E7D32)
private val Panel = Color(0xFF121212)

class MainActivity : ComponentActivity() {

    private val app get() = application as SafarApp
    private var sampleRenderer: CueRenderer? = null
    private var overlayAllowed by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sampleRenderer = CueRenderer(this) { }
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Amber, background = Color.Black, surface = Panel)) {
                Screen()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        overlayAllowed = Settings.canDrawOverlays(this)
    }

    override fun onDestroy() {
        sampleRenderer?.release()
        sampleRenderer = null
        super.onDestroy()
    }

    private fun hasLocation() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun reloadIfRunning() {
        if (RideState.state.value.running) CoPilotService.send(this, CoPilotService.ACTION_RELOAD_CONFIG)
    }

    private fun playSample() {
        val lang = app.prefs.lang
        val meta = Taxonomy["speed_breaker_unmarked"] ?: return
        sampleRenderer?.setLanguage(lang)
        sampleRenderer?.play(
            Cue("sample", "speed_breaker_unmarked", Severity.CRITICAL, CueKind.APPROACH, 120, 7.0,
                "${meta.label.getValue(lang)}, ${Taxonomy.speakDistance(120.0, lang)}",
                Earcon.CRITICAL, Haptics.CRITICAL, 0.0, CoPilotEngine.COLORS.getValue(Severity.CRITICAL), true, false),
        )
    }

    @SuppressLint("MissingPermission")
    private fun setHomeHere() {
        if (!hasLocation()) return
        LocationServices.getFusedLocationProviderClient(this).lastLocation.addOnSuccessListener { loc ->
            if (loc != null) {
                app.prefs.home = LatLon(loc.latitude, loc.longitude)
                Toast.makeText(this, R.string.home_set, Toast.LENGTH_SHORT).show()
            }
        }
    }

    // ===================================================================== UI

    @OptIn(ExperimentalLayoutApi::class)
    @Composable
    private fun Screen() {
        val ride by RideState.state.collectAsState()
        val scope = rememberCoroutineScope()
        var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
        LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis(); delay(1000) } }

        var vehicle by remember { mutableStateOf(app.prefs.vehicle) }
        var mode by remember { mutableStateOf(app.prefs.mode) }
        var lang by remember { mutableStateOf(app.prefs.lang) }
        var raining by remember { mutableStateOf(app.prefs.raining) }
        var funMode by remember { mutableStateOf(app.prefs.funMode) }
        var consent by remember { mutableStateOf(app.prefs.telemetryConsent) }
        var locationOk by remember { mutableStateOf(hasLocation()) }

        val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            locationOk = hasLocation()
            if (locationOk) CoPilotService.start(this)
        }

        fun startDuty() {
            if (!hasLocation()) {
                val perms = buildList {
                    add(Manifest.permission.ACCESS_FINE_LOCATION)
                    add(Manifest.permission.ACCESS_COARSE_LOCATION)
                    if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
                }
                permLauncher.launch(perms.toTypedArray())
            } else {
                CoPilotService.start(this)
            }
        }

        Column(
            Modifier.fillMaxSize().background(Color.Black).verticalScroll(rememberScrollState()).padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(stringResource(R.string.app_name), color = Amber, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(20.dp))

            // ---- duty toggle: the one big control
            Box(
                Modifier.size(190.dp).background(if (ride.running) Green else Panel, CircleShape)
                    .border(4.dp, if (ride.running) Color.White else Amber, CircleShape)
                    .clickable { if (ride.running) CoPilotService.stop(this@MainActivity) else startDuty() },
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(stringResource(if (ride.running) R.string.on_duty else R.string.off_duty),
                        color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    ride.fix?.takeIf { ride.running }?.let {
                        Text("${(it.speedMps * 3.6).toInt()} km/h", color = Color.White, fontSize = 16.sp)
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            Text(stringResource(if (ride.running) R.string.alerts_running else R.string.tap_to_start),
                color = Color.LightGray, textAlign = TextAlign.Center)
            ride.lastCueText?.takeIf { ride.running }?.let { Text(it, color = Amber, fontSize = 18.sp) }
            ride.ttsMissing?.let {
                Text("Voice for ${it.code} not installed on this phone: using English. Install it in Settings > Text-to-speech.",
                    color = Color(0xFFFF8A80), fontSize = 13.sp, textAlign = TextAlign.Center)
            }

            if (!locationOk) Notice(stringResource(R.string.perm_location)) { startDuty() }
            if (!overlayAllowed) Notice(stringResource(R.string.perm_overlay)) {
                startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            }

            Spacer(Modifier.height(12.dp))
            Text(stringResource(R.string.disclaimer), color = Color.Gray, fontSize = 12.sp, textAlign = TextAlign.Center)

            // ---- report (stopped only)
            Section(stringResource(R.string.report_title)) {
                val canReport = ride.canReport(now)
                if (!canReport) {
                    Text(stringResource(R.string.report_stop_first), color = Color.Gray, fontSize = 13.sp)
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Taxonomy.quickReport.forEach { type ->
                        val label = Taxonomy[type]?.label?.get(lang)?.substringBefore(',') ?: type
                        Button(
                            onClick = {
                                val fix = RideState.state.value.fix ?: return@Button
                                scope.launch {
                                    withContext(Dispatchers.IO) { Reporter.reportHazard(this@MainActivity, type, fix) }
                                    Toast.makeText(this@MainActivity, R.string.report_saved, Toast.LENGTH_SHORT).show()
                                }
                            },
                            enabled = canReport,
                            modifier = Modifier.heightIn(min = 56.dp),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF263238), contentColor = Color.White),
                        ) { Text(label, fontSize = 15.sp) }
                    }
                }
            }

            // ---- settings
            Section(stringResource(R.string.vehicle)) {
                ChoiceRow(listOf(
                    VehicleClass.TWO_WHEELER to R.string.v_2w, VehicleClass.THREE_WHEELER to R.string.v_3w,
                    VehicleClass.CAR to R.string.v_car, VehicleClass.BUS to R.string.v_bus, VehicleClass.TRUCK to R.string.v_truck,
                ), vehicle) { vehicle = it; app.prefs.vehicle = it; reloadIfRunning() }
            }
            Section(stringResource(R.string.mode)) {
                ChoiceRow(listOf(
                    RiderMode.NOVICE to R.string.m_novice, RiderMode.STANDARD to R.string.m_standard, RiderMode.GIG to R.string.m_gig,
                ), mode) { mode = it; app.prefs.mode = it; reloadIfRunning() }
            }
            Section(stringResource(R.string.language)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(Lang.TE to "తెలుగు", Lang.TA to "தமிழ்", Lang.HI to "हिन्दी", Lang.EN to "English").forEach { (l, name) ->
                        Chip(name, lang == l) { lang = l; app.prefs.lang = l; reloadIfRunning() }
                    }
                }
            }
            Section(null) {
                SwitchRow(stringResource(R.string.rain_mode), raining) { raining = it; app.prefs.raining = it }
                SwitchRow(stringResource(R.string.fun_mode), funMode) { funMode = it; app.prefs.funMode = it; reloadIfRunning() }
                SwitchRow(stringResource(R.string.consent_telemetry), consent) { consent = it; app.prefs.telemetryConsent = it }
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { setHomeHere() }, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.set_home))
                }
                OutlinedButton(onClick = { playSample() }, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.test_alert))
                }
            }
            Spacer(Modifier.height(40.dp))
        }
    }

    @Composable
    private fun Section(title: String?, content: @Composable () -> Unit) {
        Spacer(Modifier.height(18.dp))
        Column(Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(16.dp)).padding(14.dp)) {
            title?.let { Text(it, color = Amber, fontWeight = FontWeight.SemiBold, fontSize = 16.sp); Spacer(Modifier.height(8.dp)) }
            content()
        }
    }

    @OptIn(ExperimentalLayoutApi::class)
    @Composable
    private fun <T> ChoiceRow(options: List<Pair<T, Int>>, selected: T, onSelect: (T) -> Unit) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { (value, res) -> Chip(stringResource(res), value == selected) { onSelect(value) } }
        }
    }

    @Composable
    private fun Chip(text: String, selected: Boolean, onClick: () -> Unit) {
        FilterChip(
            selected = selected, onClick = onClick, label = { Text(text, fontSize = 15.sp) },
            modifier = Modifier.heightIn(min = 44.dp),
            colors = FilterChipDefaults.filterChipColors(selectedContainerColor = Amber, selectedLabelColor = Color.Black),
        )
    }

    @Composable
    private fun SwitchRow(text: String, checked: Boolean, onChange: (Boolean) -> Unit) {
        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(text, color = Color.White, modifier = Modifier.weight(1f), fontSize = 14.sp)
            Switch(checked = checked, onCheckedChange = onChange)
        }
    }

    @Composable
    private fun Notice(text: String, onGrant: () -> Unit) {
        Spacer(Modifier.height(10.dp))
        Row(Modifier.fillMaxWidth().background(Color(0xFF3E2723), RoundedCornerShape(12.dp)).padding(12.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Text(text, color = Color.White, modifier = Modifier.weight(1f), fontSize = 13.sp)
            Button(onClick = onGrant) { Text(stringResource(R.string.grant)) }
        }
    }
}
