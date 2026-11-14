package com.surakshitsafar.core

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Renders an [Earcon] to 16-bit interleaved stereo PCM. No audio assets ship with the app:
 * tones are generated on device, so new cue designs are a code change, not a recording session.
 *
 * Equal-power panning (pan -1 = hard left, +1 = hard right) makes "which side" audible on
 * earphones / helmet intercoms. 8 ms attack/release ramps avoid clicks.
 */
object EarconSynth {
    const val SAMPLE_RATE = 22_050

    fun durationMs(e: Earcon): Int = e.tones.sumOf { it.second + it.third }

    fun render(e: Earcon, pan: Double, sampleRate: Int = SAMPLE_RATE): ShortArray {
        val p = pan.coerceIn(-1.0, 1.0)
        val angle = (p + 1) * PI / 4                 // 0 .. pi/2
        val gl = cos(angle) * e.volume
        val gr = sin(angle) * e.volume
        val frames = e.tones.sumOf { (_, on, off) -> (on + off) * sampleRate / 1000 }
        val out = ShortArray(frames * 2)
        var frame = 0
        val ramp = (0.008 * sampleRate).toInt()
        for ((freq, onMs, offMs) in e.tones) {
            val n = onMs * sampleRate / 1000
            for (i in 0 until n) {
                val env = min(1.0, min(i.toDouble() / ramp, (n - 1 - i).toDouble() / ramp)).coerceAtLeast(0.0)
                // fundamental + a little 2nd harmonic: cuts through engine and wind noise
                val t = i.toDouble() / sampleRate
                val s = (0.8 * sin(2 * PI * freq * t) + 0.2 * sin(4 * PI * freq * t)) * env * 0.9
                out[frame * 2] = (s * gl * Short.MAX_VALUE).roundToInt().toShort()
                out[frame * 2 + 1] = (s * gr * Short.MAX_VALUE).roundToInt().toShort()
                frame++
            }
            frame += offMs * sampleRate / 1000         // silence (array is zero-initialised)
        }
        return out
    }
}
