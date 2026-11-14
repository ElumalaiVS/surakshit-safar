package com.surakshitsafar.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/** Speed nudges, Tamil coverage and the global attention budget. */
class SpeedCoachTest {

    private val origin = LatLon(13.0827, 80.2707)     // Chennai
    private val day = RideContext()
    private val schoolTime = RideContext(schoolHours = true)

    private fun at(north: Double) = Geo.destination(origin, 0.0, north)

    private class Fired(val cue: Cue, val tS: Int, val north: Double)

    /** Ride north with a speed profile (km/h per second); returns cues with time stamps. */
    private fun ride(e: CoPilotEngine, kmhPerSecond: List<Double>, ctx: RideContext = day): List<Fired> {
        val out = ArrayList<Fired>()
        var n = 0.0
        kmhPerSecond.forEachIndexed { i, kmh ->
            val p = at(n)
            e.update(Fix(p.lat, p.lon, kmh / 3.6, 0.0, 5.0, 5_000_000L + i * 1000L), ctx).cues
                .forEach { out += Fired(it, i, n) }
            n += kmh / 3.6
        }
        return out
    }

    private fun engine(store: List<Hazard> = emptyList(), lang: Lang = Lang.EN, fun_: Boolean = true,
                       mode: RiderMode = RiderMode.STANDARD) =
        CoPilotEngine(MemoryHazardStore(store),
            EngineConfig(VehicleClass.TWO_WHEELER, mode, lang, null, funMode = fun_), SpeedCoach(Random(42)))

    private fun nudges(f: List<Fired>) = f.filter { it.cue.kind == CueKind.SPEED_NUDGE }

    @Test fun sustainedSpeedingGetsOneNudgeNotANag() {
        val f = ride(engine(), List(30) { 85.0 })
        val n = nudges(f)
        assertEquals(1, n.size)
        assertTrue("after ~8 s sustained, got ${n[0].tS}", n[0].tS in 8..10)
        assertEquals(Earcon.NUDGE, n[0].cue.earcon)
        assertFalse(n[0].cue.flash)
    }

    @Test fun briefOvertakeIsIgnored() {
        assertEquals(0, nudges(ride(engine(), List(6) { 85.0 } + List(30) { 50.0 })).size)
    }

    @Test fun ignoredNudgesBackOffThenGoQuiet() {
        // An hour flat out: 3 nudges 4 min apart, 20 min silence, then at most 1 per 30 min
        val n = nudges(ride(engine(), List(60 * 60) { 85.0 }))
        assertEquals(3, n.count { it.tS < 30 * 60 })
        assertTrue("total ${n.size} in an hour", n.size <= 5)
        assertTrue(n.zipWithNext().all { (a, b) -> b.tS - a.tS >= 240 })
        assertTrue("after back-off, >= 30 min apart", n.drop(3).zipWithNext().all { (a, b) -> b.tS - a.tS >= 1800 })
    }

    @Test fun complianceEarnsRarePraiseInFunModeOnly() {
        val profile = List(12) { 85.0 } + List(20) { 50.0 }
        val withFun = ride(engine(fun_ = true), profile)
        assertEquals(listOf(CueKind.SPEED_NUDGE, CueKind.SPEED_PRAISE), withFun.map { it.cue.kind })
        val plain = ride(engine(fun_ = false, lang = Lang.TA), profile)
        assertEquals(listOf(CueKind.SPEED_NUDGE), plain.map { it.cue.kind })
        assertEquals(SpeedCoach.PLAIN.getValue(Lang.TA), plain[0].cue.speech)
    }

    @Test fun tamilFunLinesRotateWithoutRepeats() {
        val coach = SpeedCoach(Random(7))
        val cfg = EngineConfig(VehicleClass.TWO_WHEELER, RiderMode.STANDARD, Lang.TA)
        val lines = ArrayList<String>()
        var t = 0L
        repeat(6) {
            // speed for 9 s -> nudge; then comply; then 11 min of calm riding
            var got: String? = null
            for (s in 0..9) coach.update(t + s * 1000, 85.0, 5.0, cfg, day, emptyList(), false)?.let { got = it.speech }
            coach.update(t + 15_000, 40.0, 5.0, cfg, day, emptyList(), false)
            lines += requireNotNull(got)
            t += 11 * 60_000L
        }
        assertEquals("pool of 6 plays once each before repeating", 6, lines.toSet().size)
        assertTrue(lines.all { it in SpeedCoach.FUN_GENERAL.getValue(Lang.TA) + SpeedCoach.FUN_FAMILY.getValue(Lang.TA) })
    }

    @Test fun gigModeGetsDeliveryLines() {
        val coach = SpeedCoach(Random(1))
        val cfg = EngineConfig(VehicleClass.TWO_WHEELER, RiderMode.GIG, Lang.TA)
        val lines = HashSet<String>()
        var t = 0L
        repeat(6) {
            for (s in 0..9) coach.update(t + s * 1000, 85.0, 5.0, cfg, day, emptyList(), false)?.let { lines += it.speech }
            coach.update(t + 15_000, 40.0, 5.0, cfg, day, emptyList(), false)
            t += 11 * 60_000L
        }
        assertTrue(lines.containsAll(SpeedCoach.FUN_GIG.getValue(Lang.TA)))
    }

    @Test fun schoolZoneWarningComesFirstThenPlainZoneNudge() {
        // school zone mapped as a 400 m stretch of road, as panchayats would pin it
        val school = Hazard("sch", "school_zone", at(300.0).lat, at(300.0).lon,
            extent = listOf(at(300.0), at(500.0), at(700.0)), severity = Severity.WARNING,
            status = "authority_verified", trustTier = 1, confidence = 0.95)
        val f = ride(engine(listOf(school), lang = Lang.TA), List(60) { 40.0 }, schoolTime)
        val approach = f.first { it.cue.kind == CueKind.APPROACH }
        val nudge = nudges(f).single()
        assertTrue("warning first", approach.tS < nudge.tS)
        assertTrue("8 s quiet gap after the warning", nudge.tS - approach.tS >= 8)
        assertTrue("nudged while still inside the zone", nudge.north in 300.0..700.0)
        assertTrue("plain zone line, no joke: ${nudge.cue.speech}", nudge.cue.speech!!.startsWith("பள்ளி குழந்தைகள்"))
        assertTrue(nudge.cue.speech!!.endsWith(Taxonomy.slowDown.getValue(Lang.TA)))

        // Outside school hours the zone is inactive: 40 km/h is fine, nothing fires
        assertEquals(0, ride(engine(listOf(school)), List(60) { 40.0 }, day).size)
    }

    @Test fun nudgeNeverStepsOnAnUpcomingHazard() {
        val crater = Hazard("c", "crater_deep_pothole", at(250.0).lat, at(250.0).lon, severity = Severity.CRITICAL,
            status = "authority_verified", trustTier = 1, confidence = 0.95)
        val f = ride(engine(listOf(crater)), List(25) { 85.0 })
        val approach = f.first { it.cue.hazardId == "c" && it.cue.kind == CueKind.APPROACH }
        nudges(f).forEach { assertTrue("nudge at ${it.tS}s vs warning ${approach.tS}s", it.tS - approach.tS >= 8) }
    }

    @Test fun voiceBudgetCapsNonCriticalButNeverCritical() {
        // a warning every ~300 m for 3 minutes, then a critical crater: an annoying road
        val gaps = (1..10).map { i ->
            Hazard("g$i", "unmarked_median_gap", at(i * 300.0).lat, at(i * 300.0).lon, severity = Severity.WARNING,
                status = "community_verified", trustTier = 2, confidence = 0.9)
        }
        val crater = Hazard("crater", "crater_deep_pothole", at(3150.0).lat, at(3150.0).lon,
            severity = Severity.CRITICAL, status = "authority_verified", trustTier = 1, confidence = 0.95)
        val f = ride(engine(gaps + crater, fun_ = false), List(200) { 55.0 })
        val warnings = f.filter { it.cue.hazardType == "unmarked_median_gap" }
        assertEquals(10, warnings.size)
        assertTrue("all still buzz", warnings.all { it.cue.haptic.isNotEmpty() })
        assertEquals(CoPilotEngine.VOICE_BUDGET, warnings.count { it.cue.speech != null })
        val c = f.first { it.cue.hazardId == "crater" && it.cue.kind == CueKind.APPROACH }
        assertTrue("critical always speaks", c.cue.speech != null)
    }

    @Test fun everyLineExistsInEveryLanguage() {
        for ((type, meta) in Taxonomy.types) {
            for (l in Lang.entries) assertTrue("$type/$l", meta.label[l]?.isNotBlank() == true)
        }
        for (m in listOf(SpeedCoach.PLAIN, SpeedCoach.PRAISE, Taxonomy.slowDown, Taxonomy.possible,
                         Taxonomy.roughStretch, Taxonomy.nextWord)) {
            assertTrue(Lang.entries.all { m[it]?.isNotBlank() == true })
        }
        for (m in listOf(SpeedCoach.FUN_GENERAL, SpeedCoach.FUN_GIG, SpeedCoach.FUN_FAMILY)) {
            assertTrue(Lang.entries.all { (m[it]?.size ?: 0) >= 2 })
        }
        assertEquals("100 மீட்டர்", Taxonomy.speakDistance(133.0, Lang.TA))
    }

    @Test fun tamilHazardCueIsPlainAndClear() {
        val sb = Hazard("sb", "speed_breaker_unmarked", at(500.0).lat, at(500.0).lon, severity = Severity.CRITICAL,
            status = "authority_verified", trustTier = 1, confidence = 0.95)
        val c = ride(engine(listOf(sb), lang = Lang.TA), List(40) { 50.0 })
            .first { it.cue.kind == CueKind.APPROACH }.cue
        assertTrue(c.speech!!.startsWith("முன்னால் வேகத்தடை, "))
        assertTrue(c.speech!!.endsWith("மீட்டர்"))
    }
}
