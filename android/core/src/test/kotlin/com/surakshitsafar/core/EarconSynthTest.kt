package com.surakshitsafar.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class EarconSynthTest {

    private fun energy(pcm: ShortArray, channel: Int): Double {
        var e = 0.0
        var i = channel
        while (i < pcm.size) { e += abs(pcm[i].toDouble()); i += 2 }
        return e
    }

    @Test fun lengthMatchesToneSpec() {
        for (e in Earcon.entries) {
            val pcm = EarconSynth.render(e, 0.0)
            val expectedFrames = e.tones.sumOf { (_, on, off) -> (on + off) * EarconSynth.SAMPLE_RATE / 1000 }
            assertEquals(e.name, expectedFrames * 2, pcm.size)
        }
    }

    @Test fun panningMovesEnergy() {
        val left = EarconSynth.render(Earcon.CRITICAL, -1.0)
        val right = EarconSynth.render(Earcon.CRITICAL, 1.0)
        val centre = EarconSynth.render(Earcon.CRITICAL, 0.0)
        assertTrue(energy(left, 0) > 50 * (energy(left, 1) + 1))
        assertTrue(energy(right, 1) > 50 * (energy(right, 0) + 1))
        val ratio = energy(centre, 0) / energy(centre, 1)
        assertTrue("centre ratio $ratio", ratio in 0.99..1.01)
    }

    @Test fun noClippingAndClickFreeEdges() {
        for (e in Earcon.entries) {
            val pcm = EarconSynth.render(e, 0.3)
            assertTrue(pcm.all { it != Short.MIN_VALUE })
            assertTrue("starts silent", abs(pcm[0].toInt()) < 500 && abs(pcm[1].toInt()) < 500)
        }
    }

    @Test fun criticalLouderThanInfo() {
        assertTrue(energy(EarconSynth.render(Earcon.CRITICAL, 0.0), 0) / EarconSynth.durationMs(Earcon.CRITICAL) >
            energy(EarconSynth.render(Earcon.INFO, 0.0), 0) / EarconSynth.durationMs(Earcon.INFO))
    }
}
