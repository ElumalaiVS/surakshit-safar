package com.surakshitsafar.core

import kotlin.random.Random

/**
 * Over-speed nudges: the one place the app is allowed a sense of humour.
 *
 * Rules, in order of priority:
 *  1. Hazards first. No nudge while a hazard cue fired in the last 8 s or a warning/critical
 *     hazard is about to be announced. The nudge never competes with a warning.
 *  2. Only sustained speeding: over limit*1.10 + 5 km/h for 8 s (4 s inside a zone).
 *     A brief overtake is not a nag.
 *  3. Rare: 4 min between nudges, at most 3 per 30 min.
 *  4. Respect the rider: 3 ignored nudges in a row -> silence for 20 min, then at most one
 *     per 30 min until they ease off once. Nagging gets apps uninstalled, and an
 *     uninstalled app warns nobody about the next crater.
 *  5. Zones are serious: in a school / pedestrian / cattle zone the line is plain, never a joke.
 *  6. Praise is rarer still: once per 30 min, only in fun mode, only after the rider eased off.
 *
 * Limits are *comfort* limits for safe riding (per vehicle, lowered at night and in rain,
 * lower in zones), not legal speed limits. The rider can set their own.
 * Speech is fixed text (no speeds read out) so it is natural and quick to hear.
 */
class SpeedCoach(private val random: Random = Random.Default) {

    data class Nudge(val kind: CueKind, val speech: String, val limitKmh: Double, val zoneType: String?)

    private var overSinceMs: Long? = null
    private var lastNudgeMs = Long.MIN_VALUE / 2
    private val nudgeTimes = ArrayDeque<Long>()
    private var ignoredStreak = 0
    private var muteUntilMs = Long.MIN_VALUE / 2
    private var backedOff = false
    private var awaitingOutcomeUntilMs: Long? = null
    private var awaitingLimit = 0.0
    private var lastPraiseMs = Long.MIN_VALUE / 2
    private val bags = HashMap<Pair<Lang, Boolean>, ArrayDeque<String>>()

    /** Comfort limit for open road, before zones. */
    fun baseLimitKmh(cfg: EngineConfig, ctx: RideContext): Double {
        val base = cfg.cruiseLimitKmh ?: when (cfg.vehicle) {
            VehicleClass.TWO_WHEELER -> 60.0
            VehicleClass.THREE_WHEELER -> 50.0
            VehicleClass.CAR -> 80.0
            VehicleClass.BUS -> 70.0
            VehicleClass.TRUCK -> 60.0
        }
        var limit = base
        if (ctx.night) limit -= 10
        if (ctx.raining) limit -= 10
        return limit.coerceAtLeast(30.0)
    }

    /**
     * @param activeZones hazard types of active zones the rider is currently inside
     * @param hazardBusy  true if a hazard cue just fired or one is about to
     */
    fun update(
        nowMs: Long, speedKmh: Double, accuracyM: Double, cfg: EngineConfig, ctx: RideContext,
        activeZones: List<String>, hazardBusy: Boolean,
    ): Nudge? {
        while (nudgeTimes.isNotEmpty() && nowMs - nudgeTimes.first() > WINDOW_MS) nudgeTimes.removeFirst()

        val zone = activeZones.minByOrNull { ZONE_LIMITS[it] ?: Double.MAX_VALUE }?.takeIf { it in ZONE_LIMITS }
        val limit = minOf(baseLimitKmh(cfg, ctx), zone?.let { ZONE_LIMITS.getValue(it) } ?: Double.MAX_VALUE)
        val over = speedKmh > limit * 1.10 + 5

        // Did the rider respond to the last nudge?
        awaitingOutcomeUntilMs?.let { until ->
            if (speedKmh <= awaitingLimit * 1.05) {
                awaitingOutcomeUntilMs = null
                ignoredStreak = 0
                backedOff = false
                if (cfg.funMode && nowMs - lastPraiseMs >= WINDOW_MS && !hazardBusy) {
                    lastPraiseMs = nowMs
                    return Nudge(CueKind.SPEED_PRAISE, PRAISE.getValue(cfg.lang), limit, null)
                }
            } else if (nowMs > until) {
                awaitingOutcomeUntilMs = null
                ignoredStreak++
                if (ignoredStreak >= 3) {
                    muteUntilMs = nowMs + MUTE_MS
                    ignoredStreak = 0
                    backedOff = true
                }
            }
        }

        if (!over || accuracyM > 20) { overSinceMs = null; return null }
        val since = overSinceMs ?: nowMs.also { overSinceMs = it }
        val sustainMs = if (zone != null) 4_000 else 8_000
        if (nowMs - since < sustainMs) return null
        if (hazardBusy) return null
        if (nowMs < muteUntilMs) return null
        if (nowMs - lastNudgeMs < COOLDOWN_MS) return null
        if (nudgeTimes.size >= (if (backedOff) 1 else MAX_PER_WINDOW)) return null

        lastNudgeMs = nowMs
        nudgeTimes.addLast(nowMs)
        awaitingOutcomeUntilMs = nowMs + OUTCOME_MS
        awaitingLimit = limit
        overSinceMs = null

        val speech = when {
            zone != null -> "${Taxonomy[zone]?.label?.getValue(cfg.lang) ?: ""}, ${Taxonomy.slowDown.getValue(cfg.lang)}"
            !cfg.funMode -> PLAIN.getValue(cfg.lang)
            else -> nextFunLine(cfg.lang, cfg.mode == RiderMode.GIG)
        }
        return Nudge(CueKind.SPEED_NUDGE, speech, limit, zone)
    }

    /** Shuffle-bag: every line plays once before any repeats, so jokes stay fresh. */
    private fun nextFunLine(lang: Lang, gig: Boolean): String {
        val bag = bags.getOrPut(lang to gig) { ArrayDeque() }
        if (bag.isEmpty()) {
            val pool = FUN_GENERAL.getValue(lang) + (if (gig) FUN_GIG.getValue(lang) else FUN_FAMILY.getValue(lang))
            bag.addAll(pool.shuffled(random))
        }
        return bag.removeFirst()
    }

    companion object {
        const val COOLDOWN_MS = 4 * 60_000L
        const val WINDOW_MS = 30 * 60_000L
        const val MAX_PER_WINDOW = 3
        const val MUTE_MS = 20 * 60_000L
        const val OUTCOME_MS = 30_000L

        /** How far around a point zone it applies, metres. Stretch zones use their extent. */
        val ZONE_RADIUS_M = mapOf(
            "school_zone" to 150.0,
            "high_pedestrian_zone" to 120.0,
            "stray_cattle_zone" to 200.0,
            "village_road_merge" to 80.0,
            "pothole_dense_stretch" to 100.0,
            "wrong_side_hot_zone" to 150.0,
            "unlit_dark_zone" to 150.0,
            "fog_prone_stretch" to 200.0,
        )

        /** Comfort limits (km/h) while inside an active zone. */
        val ZONE_LIMITS = mapOf(
            "school_zone" to 25.0,
            "high_pedestrian_zone" to 30.0,
            "pothole_dense_stretch" to 30.0,
            "stray_cattle_zone" to 40.0,
            "village_road_merge" to 40.0,
            "wrong_side_hot_zone" to 40.0,
            "unlit_dark_zone" to 50.0,
            "fog_prone_stretch" to 40.0,
        )

        val PLAIN = mapOf(
            Lang.EN to "You're going fast. Ease off.",
            Lang.TE to "వేగం ఎక్కువ, నెమ్మదిగా వెళ్ళండి",
            Lang.HI to "रफ़्तार ज़्यादा है, धीरे चलें",
            Lang.TA to "வேகம் அதிகம், மெதுவாக செல்லுங்கள்",
        )

        // Original lines in everyday street banter. No film dialogues, no actors' catchphrases,
        // no mocking: the joke is on the speed, never on the rider.
        val FUN_GENERAL = mapOf(
            Lang.TA to listOf(
                "பாஸ், இது ரேஸ் ட்ராக் இல்ல… கொஞ்சம் மெதுவா!",
                "ஹீரோ என்ட்ரி படத்துல மட்டும் தான்… ரோட்டுல வேணாம்!",
                "ஸ்பீடு குறைச்சா ஸ்டைல் குறையாது பாஸ்!",
                "பிரேக் இருக்கு நண்பா, கொஞ்சம் யூஸ் பண்ணுங்க!",
            ),
            Lang.TE to listOf(
                "అన్నా, ఇది రేస్ ట్రాక్ కాదు… కొంచెం స్లో!",
                "హీరో ఎంట్రీ సినిమాలో మాత్రమే… రోడ్డు మీద వద్దు!",
                "స్పీడ్ తగ్గిస్తే స్టైల్ తగ్గదు బాస్!",
                "బ్రేక్ ఉంది కదా, కొంచెం వాడండి!",
            ),
            Lang.HI to listOf(
                "भाई, ये रेस ट्रैक नहीं है… थोड़ा धीरे!",
                "हीरो वाली एंट्री फ़िल्मों में अच्छी लगती है, सड़क पर नहीं!",
                "स्पीड कम करने से स्टाइल कम नहीं होता, बॉस!",
                "ब्रेक भी लगा है गाड़ी में, कभी-कभी इस्तेमाल करो!",
            ),
            Lang.EN to listOf(
                "This isn't a race track, boss. Ease off!",
                "Hero entries are for movies, not this road.",
                "Slowing down won't cost you any style.",
                "The bike has brakes too. Use them sometimes!",
            ),
        )

        /** Extra lines for delivery / ride partners (GIG mode). */
        val FUN_GIG = mapOf(
            Lang.TA to listOf(
                "பிரியாணி ஆறாது பாஸ், பொறுமையா போங்க!",
                "ஆர்டர் லேட் ஆனா பரவாயில்ல, நீங்க சேஃபா போய் சேரணும்!",
            ),
            Lang.TE to listOf(
                "బిర్యానీ చల్లారదు బాస్, నెమ్మదిగా వెళ్ళండి!",
                "ఆర్డర్ లేట్ అయినా పర్లేదు, మీరు సేఫ్‌గా చేరాలి!",
            ),
            Lang.HI to listOf(
                "बिरयानी ठंडी नहीं होगी बॉस, आराम से चलो!",
                "ऑर्डर लेट हो जाए तो चलेगा, आप सही-सलामत पहुँचो!",
            ),
            Lang.EN to listOf(
                "The biryani won't get cold. Slow down!",
                "A late order is fine. A safe you is the delivery that matters.",
            ),
        )

        /** Extra lines for everyone else. */
        val FUN_FAMILY = mapOf(
            Lang.TA to listOf(
                "வீட்டுல அம்மா வெயிட் பண்றாங்க, ஸ்பீடு குறைங்க!",
                "சீக்கிரம் போறதை விட, பத்திரமா போறது தான் மாஸ்!",
            ),
            Lang.TE to listOf(
                "ఇంట్లో అమ్మ ఎదురుచూస్తోంది, స్పీడ్ తగ్గించు!",
                "తొందరగా కన్నా, క్షేమంగా చేరడమే మాస్!",
            ),
            Lang.HI to listOf(
                "घर पर माँ इंतज़ार कर रही है, स्पीड कम करो!",
                "जल्दी पहुँचने से बड़ा है सही-सलामत पहुँचना!",
            ),
            Lang.EN to listOf(
                "Someone's waiting for you at home. Ease off.",
                "Arriving safe beats arriving early. Every time.",
            ),
        )

        val PRAISE = mapOf(
            Lang.TA to "சூப்பர்! இது தான் மாஸ்!",
            Lang.TE to "సూపర్! ఇదే మాస్!",
            Lang.HI to "शाबाश! यही असली स्टाइल है!",
            Lang.EN to "Nice. That's the real style.",
        )
    }
}
