package com.surakshitsafar.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Scenario tests: same scenarios as edge/test/engine.test.ts. */
class CoPilotEngineTest {

    private val origin = LatLon(13.6100, 79.4100)
    private val day = RideContext()
    private val night = RideContext(night = true)

    private fun at(north: Double, east: Double = 0.0): LatLon =
        Geo.destination(Geo.destination(origin, 0.0, north), 90.0, east)

    private fun hz(id: String, type: String, p: LatLon, severity: Severity = Severity.WARNING,
                   status: String = "community_verified", trustTier: Int = 2, confidence: Double = 0.85,
                   bearingDeg: Int? = null) =
        Hazard(id, type, p.lat, p.lon, null, bearingDeg, severity, status, trustTier, confidence)

    private data class Step(val north: Double, val speedKmh: Double, val heading: Double = 0.0, val east: Double = 0.0)
    private class Fired(val cue: Cue, val atNorth: Double)
    private class Drive(val cues: List<Fired>, val passes: List<PassEvent>)

    private fun drive(e: CoPilotEngine, steps: List<Step>, ctx: RideContext = day, t0: Long = 1_000_000): Drive {
        val cues = ArrayList<Fired>()
        val passes = ArrayList<PassEvent>()
        steps.forEachIndexed { i, s ->
            val p = at(s.north, s.east)
            val r = e.update(Fix(p.lat, p.lon, s.speedKmh / 3.6, s.heading, 5.0, t0 + i * 1000L), ctx)
            r.cues.forEach { cues += Fired(it, s.north) }
            passes += r.passes
        }
        return Drive(cues, passes)
    }

    private fun straight(from: Double, to: Double, kmh: Double): List<Step> {
        val out = ArrayList<Step>()
        var n = from
        while (n <= to) { out += Step(n, kmh); n += kmh / 3.6 }
        return out
    }

    private fun cfg(vehicle: VehicleClass = VehicleClass.TWO_WHEELER, mode: RiderMode = RiderMode.STANDARD,
                    lang: Lang = Lang.EN, route: List<LatLon>? = null) = EngineConfig(vehicle, mode, lang, route)

    @Test fun lookaheadGrowsWithSpeedNoviceAndRain() {
        val e = CoPilotEngine(MemoryHazardStore(emptyList()), cfg())
        val a30 = e.lookahead(30 / 3.6, Severity.CRITICAL, false)
        val a60 = e.lookahead(60 / 3.6, Severity.CRITICAL, false)
        val a80 = e.lookahead(80 / 3.6, Severity.CRITICAL, false)
        assertTrue(a30 < a60 && a60 < a80)
        assertTrue("60 km/h ~117 m, got $a60", a60 in 110.0..125.0)
        assertTrue(e.lookahead(60 / 3.6, Severity.WARNING, true) > e.lookahead(60 / 3.6, Severity.WARNING, false))
        val novice = CoPilotEngine(MemoryHazardStore(emptyList()), cfg(mode = RiderMode.NOVICE))
        assertTrue(novice.lookahead(60 / 3.6, Severity.CRITICAL, false) > a60)
    }

    @Test fun unmarkedSpeedBreakerOneTimelyCriticalCue() {
        val store = MemoryHazardStore(listOf(hz("sb1", "speed_breaker_unmarked", at(800.0), Severity.CRITICAL)))
        val e = CoPilotEngine(store, cfg(lang = Lang.TE))
        val approach = drive(e, straight(0.0, 1000.0, 60.0)).cues.map { it.cue }
            .filter { it.hazardId == "sb1" && it.kind == CueKind.APPROACH }
        assertEquals(1, approach.size)
        val c = approach[0]
        assertEquals(Severity.CRITICAL, c.level)
        assertTrue("tth ${c.timeToHazardS}", c.timeToHazardS >= 6)
        assertTrue("dist ${c.distanceM}", c.timeToHazardS <= 9 && c.distanceM <= 140)
        assertTrue(c.speech!!.contains("స్పీడ్ బ్రేకర్"))
        assertTrue(c.flash)
        assertEquals(Earcon.CRITICAL, c.earcon)
        assertEquals(6, c.haptic.size)
    }

    @Test fun hazardsBehindOrOnParallelRoadIgnored() {
        val store = MemoryHazardStore(listOf(hz("behind", "pothole", at(-50.0)), hz("side", "pothole", at(300.0, 120.0))))
        assertEquals(0, drive(CoPilotEngine(store, cfg()), straight(0.0, 500.0, 50.0)).cues.size)
    }

    @Test fun directionalAndNightOnlyParkedTruck() {
        val store = MemoryHazardStore(listOf(
            hz("truckN", "parked_heavy_vehicle", at(400.0, 3.0), Severity.CRITICAL, bearingDeg = 0),
            hz("truckS", "parked_heavy_vehicle", at(600.0, -3.0), Severity.CRITICAL, bearingDeg = 180),
        ))
        val n = drive(CoPilotEngine(store, cfg()), straight(0.0, 800.0, 50.0), night).cues
        assertEquals(setOf("truckN"), n.map { it.cue.hazardId }.toSet())
        assertEquals(0, drive(CoPilotEngine(store, cfg()), straight(0.0, 800.0, 50.0), day).cues.size)
    }

    @Test fun urgentRepeatOnlyWhenIgnored() {
        val store = MemoryHazardStore(listOf(hz("crater", "crater_deep_pothole", at(500.0), Severity.CRITICAL)))
        val ignoring = drive(CoPilotEngine(store, cfg()), straight(0.0, 600.0, 60.0)).cues
        assertTrue(ignoring.any { it.cue.kind == CueKind.URGENT_REPEAT })

        val e = CoPilotEngine(store, cfg())
        var n = 0.0; var v = 60.0; var alerted = false
        val cues = ArrayList<Cue>()
        for (i in 0 until 80) {
            if (n >= 600) break
            val p = at(n)
            val r = e.update(Fix(p.lat, p.lon, v / 3.6, 0.0, 5.0, 2_000_000L + i * 1000L), day)
            cues += r.cues
            if (r.cues.any { it.kind == CueKind.APPROACH }) alerted = true
            if (alerted) v = maxOf(25.0, v - 12)
            n += v / 3.6
        }
        assertTrue(cues.any { it.kind == CueKind.APPROACH })
        assertFalse(cues.any { it.kind == CueKind.URGENT_REPEAT })
    }

    @Test fun familiarHazardDropsVoiceKeepsHapticNoviceKeepsVoice() {
        val store = MemoryHazardStore(listOf(hz("sb", "speed_breaker_unmarked", at(300.0), Severity.CRITICAL)))
        val e = CoPilotEngine(store, cfg())
        fun commute(): List<Step> {
            val s = ArrayList<Step>()
            var n = 0.0
            while (n <= 200) { s += Step(n, 50.0); n += 13.9 }
            n = 205.0
            while (n <= 320) { s += Step(n, 15.0); n += 4.0 }
            n = 330.0
            while (n <= 600) { s += Step(n, 50.0); n += 13.9 }
            return s
        }
        for (dayN in 0 until 5) {
            val r = drive(e, commute(), day, 10_000_000L + dayN * 86_400_000L)
            assertNotNull("day ${dayN + 1} spoken", r.cues[0].cue.speech)
            assertEquals(1, r.passes.size)
            assertTrue(r.passes[0].slowed)
        }
        val sixth = drive(e, commute(), day, 10_000_000L + 5 * 86_400_000L).cues[0].cue
        assertNull(sixth.speech)
        assertNotNull(sixth.earcon)
        assertTrue(sixth.haptic.isNotEmpty())

        val novice = CoPilotEngine(store, cfg(mode = RiderMode.NOVICE))
        novice.loadFamiliarity(mapOf("sb" to CoPilotEngine.Familiarity(50, 0)))
        assertNotNull(drive(novice, straight(0.0, 400.0, 50.0)).cues[0].cue.speech)
    }

    @Test fun potholeClusterBecomesOneStretchCue() {
        val list = listOf(400.0, 450.0, 520.0, 590.0, 650.0).mapIndexed { i, n -> hz("p$i", "pothole", at(n)) }
        val cues = drive(CoPilotEngine(MemoryHazardStore(list), cfg()), straight(0.0, 800.0, 40.0)).cues.map { it.cue }
        assertEquals(listOf(CueKind.STRETCH_START, CueKind.STRETCH_END), cues.map { it.kind })
        assertTrue(cues[0].speech!!.startsWith("Rough road, for the next"))
    }

    @Test fun craterInsideClusterStillCuedIndividually() {
        val list = listOf(400.0, 450.0, 520.0, 590.0).mapIndexed { i, n -> hz("p$i", "pothole", at(n)) } +
            hz("crater", "crater_deep_pothole", at(560.0), Severity.CRITICAL)
        val cues = drive(CoPilotEngine(MemoryHazardStore(list), cfg()), straight(0.0, 800.0, 40.0)).cues.map { it.cue }
        assertTrue(cues.any { it.kind == CueKind.STRETCH_START })
        assertTrue(cues.any { it.hazardId == "crater" && it.level == Severity.CRITICAL })
    }

    @Test fun lowSpeedIsSilent() {
        val store = MemoryHazardStore(listOf(hz("p", "pothole", at(30.0))))
        assertEquals(0, drive(CoPilotEngine(store, cfg()), straight(0.0, 60.0, 5.0)).cues.size)
    }

    @Test fun telemetryCandidateIsPossibleAndCapped() {
        val store = MemoryHazardStore(listOf(hz("t3", "speed_breaker_unmarked", at(400.0), Severity.CRITICAL,
            status = "candidate", trustTier = 3, confidence = 0.45)))
        val cues = drive(CoPilotEngine(store, cfg()), straight(0.0, 500.0, 50.0)).cues.map { it.cue }
        assertEquals(1, cues.size)
        assertEquals(Severity.WARNING, cues[0].level)
        assertTrue(cues[0].tentative)
        assertTrue(cues[0].speech!!.startsWith("Possible "))
    }

    @Test fun twoWheelerNightBoostCarNot() {
        val store = MemoryHazardStore(listOf(hz("p", "pothole", at(400.0))))
        val bike = drive(CoPilotEngine(store, cfg(VehicleClass.TWO_WHEELER)), straight(0.0, 500.0, 50.0), night).cues
        val car = drive(CoPilotEngine(store, cfg(VehicleClass.CAR)), straight(0.0, 500.0, 50.0), night).cues
        assertEquals(Severity.CRITICAL, bike[0].cue.level)
        assertEquals(Severity.WARNING, car[0].cue.level)
    }

    @Test fun voiceSpacingOneSpokenBothBuzz() {
        val store = MemoryHazardStore(listOf(hz("a", "unmarked_median_gap", at(400.0)), hz("b", "village_road_merge", at(425.0))))
        val cues = drive(CoPilotEngine(store, cfg()), straight(0.0, 500.0, 60.0)).cues.map { it.cue }
        assertEquals(2, cues.size)
        assertEquals(1, cues.count { it.speech != null })
        assertTrue(cues.all { it.haptic.isNotEmpty() })
    }

    @Test fun routeModeSeesAroundBendConeCannot() {
        val route = listOf(at(0.0), at(300.0), at(300.0, 400.0))
        val store = MemoryHazardStore(listOf(hz("bend", "blind_intersection", at(300.0, 60.0), Severity.CRITICAL)))
        val steps = ArrayList<Step>()
        var n = 0.0
        while (n <= 300) { steps += Step(n, 40.0); n += 11.1 }
        val withRoute = drive(CoPilotEngine(store, cfg(route = route)), steps).cues
        assertEquals(1, withRoute.size)
        assertTrue("fired at ${withRoute[0].atNorth}", withRoute[0].atNorth in 230.0..300.0)
        assertEquals(0, drive(CoPilotEngine(store, cfg()), steps).cues.size)
    }

    @Test fun passEventsReportJolts() {
        val store = MemoryHazardStore(listOf(hz("fixed?", "pothole", at(300.0), status = "resolved_pending_check")))
        val e = CoPilotEngine(store, cfg())
        val p = at(300.0)
        e.noteJolt(1_000_000L + 21_000, p.lat, p.lon)
        val passes = drive(e, straight(0.0, 500.0, 50.0)).passes
        assertEquals(1, passes.size)
        assertTrue(passes[0].jolted)
        assertEquals("resolved_pending_check", passes[0].status)
    }

    @Test fun spokenDistanceRoundsDown() {
        assertEquals("70 metres", Taxonomy.speakDistance(78.0, Lang.EN))
        assertEquals("100 metres", Taxonomy.speakDistance(133.0, Lang.EN))
        assertEquals("150 metres", Taxonomy.speakDistance(199.0, Lang.EN))
        assertEquals("1.2 km", Taxonomy.speakDistance(1290.0, Lang.EN))
        assertEquals("10 మీటర్లు", Taxonomy.speakDistance(4.0, Lang.TE))
    }

    @Test fun geohashMatchesPostgis() {
        // reference values produced by PostGIS ST_GeoHash
        assertEquals("tf2mrj8", Geo.geohash(13.61, 79.41, 7))
        assertEquals("tf2mx3r", Geo.geohash(13.6301, 79.43, 7))
        assertEquals("ttnfucj", Geo.geohash(28.6139, 77.209, 7))
        assertEquals("t9w8qxz", Geo.geohash(8.5241, 76.9366, 7))
    }
}
