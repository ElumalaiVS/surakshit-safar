package com.surakshitsafar.app.cues

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import com.surakshitsafar.core.Cue
import com.surakshitsafar.core.Earcon
import com.surakshitsafar.core.EarconSynth
import com.surakshitsafar.core.Lang
import com.surakshitsafar.core.Severity
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Plays a [Cue]: haptic waveform + synthesized earcon (stereo-panned) + spoken prompt.
 *
 * - Audio uses USAGE_ASSISTANCE_NAVIGATION_GUIDANCE and asks for transient, duckable
 *   focus, so music and the gig app's own navigation voice dip instead of being cut.
 * - Speech starts after the earcon finishes, so the two never overlap.
 * - If the device has no Telugu/Tamil/Hindi TTS voice, [onLanguageUnavailable] fires so the
 *   service can switch the engine to English rather than speak Telugu text badly.
 *
 * Thread-safe for calls from the service's engine thread.
 */
class CueRenderer(
    private val context: Context,
    private val onLanguageUnavailable: (Lang) -> Unit,
) : TextToSpeech.OnInitListener {

    private val main = Handler(Looper.getMainLooper())
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val vibrator: Vibrator = if (Build.VERSION.SDK_INT >= 31) {
        (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }

    private val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

    private val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(attrs)
        .setWillPauseWhenDucked(false)
        .build()
    private val activeSounds = AtomicInteger(0)

    private val pcmCache = ConcurrentHashMap<Pair<Earcon, Int>, ShortArray>()

    private var tts: TextToSpeech? = TextToSpeech(context.applicationContext, this)
    @Volatile private var ttsReady = false
    @Volatile private var currentLang: Lang = Lang.TE

    // ------------------------------------------------------------------ TTS

    override fun onInit(status: Int) {
        val t = tts ?: return
        if (status != TextToSpeech.SUCCESS) {
            Log.w(TAG, "TTS init failed: $status")
            return
        }
        t.setAudioAttributes(attrs)
        t.setSpeechRate(1.05f)
        t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {}
            override fun onDone(utteranceId: String?) { releaseFocus() }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) { releaseFocus() }
            override fun onError(utteranceId: String?, errorCode: Int) { releaseFocus() }
        })
        ttsReady = true
        setLanguage(currentLang)
    }

    /** Returns false (and notifies) if this device cannot speak [lang]. */
    fun setLanguage(lang: Lang): Boolean {
        currentLang = lang
        val t = tts ?: return false
        if (!ttsReady) return true   // re-applied in onInit
        val res = t.setLanguage(localeOf(lang))
        val ok = res != TextToSpeech.LANG_MISSING_DATA && res != TextToSpeech.LANG_NOT_SUPPORTED
        if (!ok) {
            Log.w(TAG, "No TTS voice for ${lang.code}; falling back")
            t.setLanguage(Locale("en", "IN"))
            onLanguageUnavailable(lang)
        }
        return ok
    }

    private fun localeOf(lang: Lang) = when (lang) {
        Lang.TE -> Locale("te", "IN")
        Lang.HI -> Locale("hi", "IN")
        Lang.TA -> Locale("ta", "IN")
        Lang.EN -> Locale("en", "IN")
    }

    // ----------------------------------------------------------------- play

    fun play(cue: Cue) {
        vibrate(cue.haptic, cue.level)
        var delayMs = 0L
        cue.earcon?.let { e ->
            playEarcon(e, cue.pan)
            delayMs = EarconSynth.durationMs(e) + 120L
        }
        cue.speech?.let { text ->
            val flush = cue.level == Severity.CRITICAL
            main.postDelayed({ speak(text, flush) }, delayMs)
        }
    }

    private fun vibrate(timings: LongArray, level: Severity) {
        if (!vibrator.hasVibrator()) return
        val effect = if (vibrator.hasAmplitudeControl()) {
            val strength = when (level) { Severity.CRITICAL -> 255; Severity.WARNING -> 190; Severity.INFO -> 110 }
            // even indices are "off" segments in a waveform
            val amps = IntArray(timings.size) { i -> if (i % 2 == 1) strength else 0 }
            VibrationEffect.createWaveform(timings, amps, -1)
        } else {
            VibrationEffect.createWaveform(timings, -1)
        }
        vibrator.vibrate(effect)
    }

    private fun playEarcon(e: Earcon, pan: Double) {
        val panBucket = (pan * 4).toInt()                       // 9 buckets is plenty for the ear
        val pcm = pcmCache.getOrPut(e to panBucket) { EarconSynth.render(e, panBucket / 4.0) }
        val bytes = pcm.size * 2
        val track = AudioTrack.Builder()
            .setAudioAttributes(attrs)
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(EarconSynth.SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                    .build(),
            )
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(bytes)
            .build()
        try {
            track.write(pcm, 0, pcm.size)
            acquireFocus()
            track.play()
            main.postDelayed({
                runCatching { track.stop() }
                track.release()
                releaseFocus()
            }, EarconSynth.durationMs(e) + 150L)
        } catch (ex: IllegalStateException) {
            Log.w(TAG, "earcon failed", ex)
            track.release()
        }
    }

    private fun speak(text: String, flush: Boolean) {
        val t = tts ?: return
        if (!ttsReady) return
        acquireFocus()
        val params = Bundle().apply { putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f) }
        val id = "cue-${System.nanoTime()}"
        val r = t.speak(text, if (flush) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD, params, id)
        if (r != TextToSpeech.SUCCESS) releaseFocus()
    }

    private fun acquireFocus() {
        if (activeSounds.getAndIncrement() == 0) audio.requestAudioFocus(focusRequest)
    }

    private fun releaseFocus() {
        if (activeSounds.decrementAndGet() <= 0) {
            activeSounds.set(0)
            audio.abandonAudioFocusRequest(focusRequest)
        }
    }

    fun release() {
        main.removeCallbacksAndMessages(null)
        tts?.stop()
        tts?.shutdown()
        tts = null
        audio.abandonAudioFocusRequest(focusRequest)
    }

    private companion object { const val TAG = "CueRenderer" }
}
