package com.surakshitsafar.app.service

import com.surakshitsafar.core.Fix
import com.surakshitsafar.core.Lang
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** Live ride state published by [CoPilotService] for the UI. */
data class RideSnapshot(
    val running: Boolean = false,
    val fix: Fix? = null,
    val stoppedSinceMs: Long? = null,
    val lastCueText: String? = null,
    val ttsMissing: Lang? = null,
    val pendingUploads: Int = 0,
) {
    /** Reporting is only offered once the vehicle has been still for 5 s: zero-touch while moving. */
    fun canReport(nowMs: Long): Boolean {
        val f = fix ?: return false
        val since = stoppedSinceMs ?: return false
        return f.speedMps < STOPPED_MPS && nowMs - since >= 5_000 && f.accuracyM <= 30
    }

    companion object { const val STOPPED_MPS = 3 / 3.6 }
}

object RideState {
    private val _state = MutableStateFlow(RideSnapshot())
    val state: StateFlow<RideSnapshot> = _state.asStateFlow()

    fun update(transform: (RideSnapshot) -> RideSnapshot) = _state.update(transform)
}
