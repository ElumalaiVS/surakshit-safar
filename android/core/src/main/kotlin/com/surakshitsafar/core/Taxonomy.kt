package com.surakshitsafar.core

import java.util.Locale
import kotlin.math.floor
import kotlin.math.max

enum class Persistence { PERMANENT, SEMI, TRANSIENT, RECURRING }
enum class ActiveWhen { ALWAYS, NIGHT, DUSK_DAWN, SCHOOL_HOURS, RAIN }
enum class Family { GEOMETRY, SURFACE, HUMP, CONFLICT, OBSTACLE, VISIBILITY, PEOPLE }

data class HazardMeta(
    val family: Family,
    val severity: Severity,
    val persistence: Persistence,
    val directional: Boolean,
    val isStretch: Boolean,
    val activeWhen: ActiveWhen,
    val riderAlert: Boolean,
    val twoWheelerBoost: Boolean,
    val label: Map<Lang, String>,
)

/**
 * Client copy of the hazard taxonomy (mirrors db/002_taxonomy_seed.sql).
 * Hazard labels are deliberately plain in every language: warnings are never jokes.
 */
object Taxonomy {
    private fun m(
        family: Family, severity: Severity, persistence: Persistence, directional: Boolean,
        isStretch: Boolean, activeWhen: ActiveWhen, riderAlert: Boolean, twoWheelerBoost: Boolean,
        en: String, te: String, hi: String, ta: String,
    ) = HazardMeta(family, severity, persistence, directional, isStretch, activeWhen, riderAlert,
        twoWheelerBoost, mapOf(Lang.EN to en, Lang.TE to te, Lang.HI to hi, Lang.TA to ta))

    private val C = Severity.CRITICAL
    private val W = Severity.WARNING
    private val I = Severity.INFO
    private val P = Persistence.PERMANENT
    private val S = Persistence.SEMI
    private val T = Persistence.TRANSIENT
    private val R = Persistence.RECURRING
    private val A = ActiveWhen.ALWAYS

    val types: Map<String, HazardMeta> = mapOf(
        // ---- Infrastructure & geometry
        "hairpin_bend" to m(Family.GEOMETRY, C, P, true, false, A, true, false,
            "Sharp hairpin bend", "ముందు పదునైన మలుపు", "आगे तीखा मोड़", "முன்னால் கூர்மையான வளைவு"),
        "sharp_curve" to m(Family.GEOMETRY, W, P, true, false, A, true, false,
            "Sharp curve", "ముందు మలుపు", "आगे मोड़", "முன்னால் வளைவு"),
        "blind_intersection" to m(Family.CONFLICT, C, P, false, false, A, true, false,
            "Blind junction", "ముందు కనిపించని కూడలి", "आगे अंधा चौराहा", "முன்னால் மறைவான சந்திப்பு"),
        "village_road_merge" to m(Family.CONFLICT, W, P, false, false, A, true, false,
            "Side road joining", "పక్క రోడ్డు కలుస్తోంది", "साइड रोड मिल रही है", "பக்க சாலை இணைகிறது"),
        "unlit_dark_zone" to m(Family.VISIBILITY, W, P, false, true, ActiveWhen.NIGHT, true, false,
            "Dark stretch, no lights", "ముందు చీకటి దారి", "आगे अंधेरा रास्ता", "முன்னால் இருட்டான சாலை"),
        "narrow_bridge_culvert" to m(Family.GEOMETRY, W, P, false, false, A, true, false,
            "Narrow bridge", "ముందు ఇరుకైన వంతెన", "आगे संकरा पुल", "முன்னால் குறுகிய பாலம்"),
        "unprotected_edge_drop" to m(Family.GEOMETRY, C, P, false, true, A, true, false,
            "Canal edge, no barrier", "కాలువ అంచు, అడ్డు గోడ లేదు", "नहर का किनारा, रेलिंग नहीं", "கால்வாய் ஓரம், தடுப்பு இல்லை"),
        "shoulder_edge_drop" to m(Family.SURFACE, W, S, false, false, A, true, true,
            "Broken road edge", "రోడ్డు అంచు విరిగింది", "सड़क का किनारा टूटा है", "சாலை ஓரம் உடைந்துள்ளது"),
        "missing_signage" to m(Family.GEOMETRY, I, S, false, false, A, false, false,
            "Missing sign", "సూచిక బోర్డు లేదు", "संकेत बोर्ड नहीं", "அறிவிப்பு பலகை இல்லை"),
        // ---- Traffic calming & conflict
        "speed_breaker_marked" to m(Family.HUMP, I, P, false, false, A, true, false,
            "Speed breaker", "స్పీడ్ బ్రేకర్", "स्पीड ब्रेकर", "வேகத்தடை"),
        "speed_breaker_unmarked" to m(Family.HUMP, C, P, false, false, A, true, true,
            "Unmarked speed breaker", "ముందు స్పీడ్ బ్రేకర్", "आगे स्पीड ब्रेकर", "முன்னால் வேகத்தடை"),
        "rumble_strips" to m(Family.HUMP, I, P, false, false, A, true, false,
            "Rumble strips", "రంబుల్ స్ట్రిప్స్", "रंबल स्ट्रिप", "ரம்பிள் கோடுகள்"),
        "unmarked_median_gap" to m(Family.CONFLICT, W, P, false, false, A, true, false,
            "Median gap, crossing traffic", "డివైడర్ గ్యాప్, వాహనాలు దాటుతాయి", "डिवाइडर कट, वाहन मुड़ते हैं",
            "நடுத்தடுப்பு இடைவெளி, வாகனங்கள் கடக்கும்"),
        "wrong_side_hot_zone" to m(Family.CONFLICT, C, R, false, true, A, true, false,
            "Wrong-side vehicles common", "ఎదురుగా రాంగ్ సైడ్ వాహనాలు", "उल्टी दिशा से वाहन आते हैं",
            "எதிர் திசையில் வாகனங்கள் வரும்"),
        "near_miss_hotspot" to m(Family.CONFLICT, W, S, false, false, A, true, false,
            "Frequent sudden braking", "ఇక్కడ తరచూ సడన్ బ్రేకులు", "यहाँ अक्सर अचानक ब्रेक", "இங்கே அடிக்கடி திடீர் பிரேக்"),
        // ---- Dynamic & environmental
        "pothole" to m(Family.SURFACE, W, S, false, false, A, true, true,
            "Pothole", "ముందు గుంత", "आगे गड्ढा", "முன்னால் பள்ளம்"),
        "crater_deep_pothole" to m(Family.SURFACE, C, S, false, false, A, true, true,
            "Deep crater, slow down", "ముందు లోతైన గుంత, నెమ్మదిగా", "आगे गहरा गड्ढा, धीरे चलें",
            "முன்னால் ஆழமான பள்ளம், மெதுவாக"),
        "pothole_dense_stretch" to m(Family.SURFACE, W, S, false, true, A, true, true,
            "Potholes ahead", "ముందు గుంతల దారి", "आगे गड्ढों वाला रास्ता", "முன்னால் பள்ளங்கள் நிறைந்த சாலை"),
        "stray_cattle_zone" to m(Family.OBSTACLE, W, R, false, false, ActiveWhen.DUSK_DAWN, true, true,
            "Cattle on road", "రోడ్డుపై పశువులు", "सड़क पर पशु", "சாலையில் மாடுகள்"),
        "parked_heavy_vehicle" to m(Family.OBSTACLE, C, T, true, false, ActiveWhen.NIGHT, true, false,
            "Parked truck ahead", "రోడ్డు పక్కన లారీ ఆగి ఉంది", "आगे खड़ा ट्रक", "முன்னால் லாரி நிற்கிறது"),
        "waterlogging" to m(Family.SURFACE, W, T, false, false, A, true, true,
            "Waterlogged road", "రోడ్డుపై నీరు నిలిచింది", "सड़क पर पानी भरा है", "சாலையில் தண்ணீர் தேங்கியுள்ளது"),
        "oil_spill_loose_gravel" to m(Family.SURFACE, C, T, false, false, A, true, true,
            "Slippery road, oil or gravel", "జారే రోడ్డు, నూనె లేదా కంకర", "फिसलन, तेल या बजरी",
            "வழுக்கும் சாலை, எண்ணெய் அல்லது ஜல்லி"),
        "school_zone" to m(Family.PEOPLE, W, R, false, false, ActiveWhen.SCHOOL_HOURS, true, false,
            "School crossing", "స్కూల్ పిల్లలు దాటుతారు", "स्कूल के बच्चे पार करते हैं", "பள்ளி குழந்தைகள் கடக்கும் இடம்"),
        "high_pedestrian_zone" to m(Family.PEOPLE, W, P, false, false, A, true, false,
            "People crossing", "జనం రోడ్డు దాటుతారు", "लोग सड़क पार करते हैं", "மக்கள் சாலையை கடக்கிறார்கள்"),
        "construction_diversion" to m(Family.OBSTACLE, W, T, false, false, A, true, false,
            "Road work ahead", "ముందు రోడ్డు పనులు", "आगे सड़क का काम", "முன்னால் சாலை வேலை"),
        "fog_prone_stretch" to m(Family.VISIBILITY, W, R, false, true, ActiveWhen.DUSK_DAWN, true, false,
            "Fog-prone stretch", "పొగమంచు దారి", "कोहरे वाला रास्ता", "பனிமூட்டம் உள்ள சாலை"),
    )

    /** The 8 types offered in the stopped-state quick-report grid, most common first. */
    val quickReport = listOf(
        "pothole", "speed_breaker_unmarked", "crater_deep_pothole", "parked_heavy_vehicle",
        "stray_cattle_zone", "waterlogging", "oil_spill_loose_gravel", "unlit_dark_zone",
    )

    operator fun get(type: String): HazardMeta? = types[type]

    private val unitM = mapOf(Lang.EN to "metres", Lang.TE to "మీటర్లు", Lang.HI to "मीटर", Lang.TA to "மீட்டர்")
    private val unitKm = mapOf(Lang.EN to "km", Lang.TE to "కి.మీ", Lang.HI to "कि.मी.", Lang.TA to "கி.மீ")
    val nextWord = mapOf(Lang.EN to "for the next", Lang.TE to "తదుపరి", Lang.HI to "अगले", Lang.TA to "அடுத்த")
    val slowDown = mapOf(Lang.EN to "Slow down", Lang.TE to "నెమ్మదిగా", Lang.HI to "धीरे करें", Lang.TA to "மெதுவாக")
    val possible = mapOf(Lang.EN to "Possible ", Lang.TE to "బహుశా ", Lang.HI to "संभवतः ", Lang.TA to "ஒருவேளை ")
    val roughStretch = mapOf(Lang.EN to "Rough road", Lang.TE to "గుంతల దారి", Lang.HI to "खराब सड़क", Lang.TA to "மோசமான சாலை")

    /** Spoken distance, always rounded DOWN so a hazard never sounds farther than it is. */
    fun speakDistance(d: Double, lang: Lang): String {
        if (d >= 1000) return "%.1f %s".format(Locale.US, floor(d / 100) / 10, unitKm.getValue(lang))
        val r = if (d < 100) max(10, (floor(d / 10) * 10).toInt()) else (floor(d / 50) * 50).toInt()
        return "$r ${unitM.getValue(lang)}"
    }
}
