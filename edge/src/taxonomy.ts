// Client-side copy of the hazard taxonomy (mirrors db/002_taxonomy_seed.sql).
// Shipped in the app and refreshed from the server; labels feed the voice layer.

export type Severity = 'info' | 'warning' | 'critical';
export type Persistence = 'permanent' | 'semi' | 'transient' | 'recurring';
export type ActiveWhen = 'always' | 'night' | 'dusk_dawn' | 'school_hours' | 'rain' | 'monsoon_season';
export type Family = 'geometry' | 'surface' | 'hump' | 'conflict' | 'obstacle' | 'visibility' | 'people';
export type Lang = 'en' | 'te' | 'hi';

export interface HazardMeta {
  family: Family;
  severity: Severity;
  persistence: Persistence;
  directional: boolean;
  isStretch: boolean;
  activeWhen: ActiveWhen;
  riderAlert: boolean;
  twoWheelerBoost: boolean;
  label: Record<Lang, string>;
}

export const TAXONOMY: Record<string, HazardMeta> = {
  // ---- Infrastructure & geometry ----
  hairpin_bend:           m('geometry',  'critical','permanent', true,  false,'always',      true,  false, 'Sharp hairpin bend',         'ముందు పదునైన మలుపు',             'आगे तीखा मोड़'),
  sharp_curve:            m('geometry',  'warning', 'permanent', true,  false,'always',      true,  false, 'Sharp curve',                'ముందు మలుపు',                    'आगे मोड़'),
  blind_intersection:     m('conflict',  'critical','permanent', false, false,'always',      true,  false, 'Blind junction',             'ముందు కనిపించని కూడలి',           'आगे अंधा चौराहा'),
  village_road_merge:     m('conflict',  'warning', 'permanent', false, false,'always',      true,  false, 'Side road joining',          'పక్క రోడ్డు కలుస్తోంది',            'साइड रोड मिल रही है'),
  unlit_dark_zone:        m('visibility','warning', 'permanent', false, true, 'night',       true,  false, 'Dark stretch, no lights',    'ముందు చీకటి దారి',                'आगे अंधेरा रास्ता'),
  narrow_bridge_culvert:  m('geometry',  'warning', 'permanent', false, false,'always',      true,  false, 'Narrow bridge',              'ముందు ఇరుకైన వంతెన',              'आगे संकरा पुल'),
  unprotected_edge_drop:  m('geometry',  'critical','permanent', false, true, 'always',      true,  false, 'Canal edge, no barrier',     'కాలువ అంచు, అడ్డు గోడ లేదు',       'नहर का किनारा, रेलिंग नहीं'),
  shoulder_edge_drop:     m('surface',   'warning', 'semi',      false, false,'always',      true,  true,  'Broken road edge',           'రోడ్డు అంచు విరిగింది',             'सड़क का किनारा टूटा है'),
  missing_signage:        m('geometry',  'info',    'semi',      false, false,'always',      false, false, 'Missing sign',               'సూచిక బోర్డు లేదు',                'संकेत बोर्ड नहीं'),
  // ---- Traffic calming & conflict ----
  speed_breaker_marked:   m('hump',      'info',    'permanent', false, false,'always',      true,  false, 'Speed breaker',              'స్పీడ్ బ్రేకర్',                  'स्पीड ब्रेकर'),
  speed_breaker_unmarked: m('hump',      'critical','permanent', false, false,'always',      true,  true,  'Unmarked speed breaker',     'ముందు స్పీడ్ బ్రేకర్',             'आगे स्पीड ब्रेकर'),
  rumble_strips:          m('hump',      'info',    'permanent', false, false,'always',      true,  false, 'Rumble strips',              'రంబుల్ స్ట్రిప్స్',                 'रंबल स्ट्रिप'),
  unmarked_median_gap:    m('conflict',  'warning', 'permanent', false, false,'always',      true,  false, 'Median gap, crossing traffic','డివైడర్ గ్యాప్, వాహనాలు దాటుతాయి', 'डिवाइडर कट, वाहन मुड़ते हैं'),
  wrong_side_hot_zone:    m('conflict',  'critical','recurring', false, true, 'always',      true,  false, 'Wrong-side vehicles common', 'ఎదురుగా రాంగ్ సైడ్ వాహనాలు',       'उल्टी दिशा से वाहन आते हैं'),
  near_miss_hotspot:      m('conflict',  'warning', 'semi',      false, false,'always',      true,  false, 'Frequent sudden braking',    'ఇక్కడ తరచూ సడన్ బ్రేకులు','यहाँ अक्सर अचानक ब्रेक'),
  // ---- Dynamic & environmental ----
  pothole:                m('surface',   'warning', 'semi',      false, false,'always',      true,  true,  'Pothole',                    'ముందు గుంత',                     'आगे गड्ढा'),
  crater_deep_pothole:    m('surface',   'critical','semi',      false, false,'always',      true,  true,  'Deep crater, slow down',     'ముందు లోతైన గుంత, నెమ్మదిగా',       'आगे गहरा गड्ढा, धीरे चलें'),
  pothole_dense_stretch:  m('surface',   'warning', 'semi',      false, true, 'always',      true,  true,  'Potholes ahead',             'ముందు గుంతల దారి',               'आगे गड्ढों वाला रास्ता'),
  stray_cattle_zone:      m('obstacle',  'warning', 'recurring', false, false,'dusk_dawn',   true,  true,  'Cattle on road',             'రోడ్డుపై పశువులు',               'सड़क पर पशु'),
  parked_heavy_vehicle:   m('obstacle',  'critical','transient', true,  false,'night',       true,  false, 'Parked truck ahead',         'రోడ్డు పక్కన లారీ ఆగి ఉంది',        'आगे खड़ा ट्रक'),
  waterlogging:           m('surface',   'warning', 'transient', false, false,'always',      true,  true,  'Waterlogged road',           'రోడ్డుపై నీరు నిలిచింది',            'सड़क पर पानी भरा है'),
  oil_spill_loose_gravel: m('surface',   'critical','transient', false, false,'always',      true,  true,  'Slippery road, oil or gravel','జారే రోడ్డు, నూనె లేదా కంకర',       'फिसलन, तेल या बजरी'),
  school_zone:            m('people',    'warning', 'recurring', false, false,'school_hours',true,  false, 'School crossing',            'స్కూల్ పిల్లలు దాటుతారు',           'स्कूल के बच्चे पार करते हैं'),
  high_pedestrian_zone:   m('people',    'warning', 'permanent', false, false,'always',      true,  false, 'People crossing',            'జనం రోడ్డు దాటుతారు',               'लोग सड़क पार करते हैं'),
  construction_diversion: m('obstacle',  'warning', 'transient', false, false,'always',      true,  false, 'Road work ahead',            'ముందు రోడ్డు పనులు',               'आगे सड़क का काम'),
  fog_prone_stretch:      m('visibility','warning', 'recurring', false, true, 'dusk_dawn',   true,  false, 'Fog-prone stretch',          'పొగమంచు దారి',                   'कोहरे वाला रास्ता'),
};

function m(family: Family, severity: Severity, persistence: Persistence, directional: boolean,
           isStretch: boolean, activeWhen: ActiveWhen, riderAlert: boolean, twoWheelerBoost: boolean,
           en: string, te: string, hi: string): HazardMeta {
  return { family, severity, persistence, directional, isStretch, activeWhen, riderAlert,
           twoWheelerBoost, label: { en, te, hi } };
}

// ---------------------------------------------------------------------------
// Cue vocabulary: each level must be recognisable WITHOUT looking at the phone.
// Haptics are Android VibrationEffect.createWaveform timings: [off, on, off, on, ...] ms.
// ---------------------------------------------------------------------------
export const HAPTIC: Record<string, number[]> = {
  critical:      [0, 400, 120, 400, 120, 600],  // three long, insistent pulses
  critical_urgent:[0, 150, 60, 150, 60, 150, 60, 150, 60, 600],
  warning:       [0, 180, 140, 180],            // two short
  info:          [0, 60],                       // single light tick
  stretch_start: [0, 90, 70, 90, 70, 90],       // rapid triple: "rough section begins"
  stretch_end:   [0, 40, 200, 40],
};

export const EARCON: Record<string, string> = {
  critical:       'earcon/critical_rising_3tone.opus',  // 880 -> 1175 -> 1568 Hz, 600 ms
  critical_urgent:'earcon/critical_repeat_fast.opus',
  warning:        'earcon/warning_double.opus',         // 660 Hz x2
  info:           'earcon/info_soft.opus',              // 440 Hz, 120 ms, -12 dB
  stretch_start:  'earcon/stretch_start.opus',
  stretch_end:    'earcon/stretch_end.opus',
};

export const UNITS: Record<Lang, { m: string; km: string; next: string }> = {
  en: { m: 'metres', km: 'km', next: 'for the next' },
  te: { m: 'మీటర్లు', km: 'కి.మీ', next: 'తదుపరి' },
  hi: { m: 'मीटर', km: 'कि.मी.', next: 'अगले' },
};

/**
 * Spoken distances are rounded DOWN so they are easy to hear and never make a
 * hazard sound farther away than it is.
 */
export function speakDistance(d: number, lang: Lang): string {
  const u = UNITS[lang];
  if (d >= 1000) return `${(Math.floor(d / 100) / 10).toFixed(1)} ${u.km}`;
  const r = d < 100 ? Math.max(10, Math.floor(d / 10) * 10) : Math.floor(d / 50) * 50;
  return `${r} ${u.m}`;
}
