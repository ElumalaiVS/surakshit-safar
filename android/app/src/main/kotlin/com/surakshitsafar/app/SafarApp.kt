package com.surakshitsafar.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.surakshitsafar.app.data.HazardDb
import com.surakshitsafar.app.data.Prefs
import com.surakshitsafar.app.sync.SyncWorker

class SafarApp : Application() {

    lateinit var prefs: Prefs
        private set
    lateinit var db: HazardDb
        private set

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        db = HazardDb(this)
        createChannel()
        SyncWorker.schedulePeriodic(this)
    }

    private fun createChannel() {
        val ch = NotificationChannel(CHANNEL_DUTY, getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW).apply {
            description = getString(R.string.channel_desc)
            setShowBadge(false)
            setSound(null, null)            // cues have their own audio; the notification stays silent
            enableVibration(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
    }

    companion object {
        const val CHANNEL_DUTY = "duty"
    }
}
