-- =============================================================================
--  002_taxonomy_seed.sql : hazard taxonomy + SLA policy
--  Taxonomy is data. Adding a hazard type = INSERT here, no app release.
-- =============================================================================
SET search_path = safar, public;

INSERT INTO hazard_types
 (code, category, label_en, default_severity, persistence, ttl_hours, dedupe_radius_m,
  directional, active_when, rider_alert, two_wheeler_boost, is_stretch)
VALUES
-- ---------------- Infrastructure & geometry ----------------
 ('hairpin_bend',            'infrastructure_geometry', 'Sharp hairpin bend',                'critical','permanent', NULL, 60, true,  'always',        true,  false, false),
 ('sharp_curve',             'infrastructure_geometry', 'Sharp curve',                       'warning', 'permanent', NULL, 60, true,  'always',        true,  false, false),
 ('blind_intersection',      'infrastructure_geometry', 'Blind intersection',                'critical','permanent', NULL, 40, false, 'always',        true,  false, false),
 ('village_road_merge',      'infrastructure_geometry', 'Village road joins highway',        'warning', 'permanent', NULL, 40, false, 'always',        true,  false, false),
 ('unlit_dark_zone',         'infrastructure_geometry', 'Unlit dark stretch',                'warning', 'permanent', NULL,150, false, 'night',         true,  false, true ),
 ('narrow_bridge_culvert',   'infrastructure_geometry', 'Narrow bridge or culvert',          'warning', 'permanent', NULL, 50, false, 'always',        true,  false, false),
 ('unprotected_edge_drop',   'infrastructure_geometry', 'Canal/embankment edge, no barrier', 'critical','permanent', NULL, 60, false, 'always',        true,  false, true ),
 ('shoulder_edge_drop',      'infrastructure_geometry', 'Broken edge / shoulder drop',       'warning', 'semi',      2160, 40, false, 'always',        true,  true,  false),
 ('missing_signage',         'infrastructure_geometry', 'Missing or damaged sign',           'info',    'semi',      NULL, 40, false, 'always',        false, false, false),
-- ---------------- Traffic calming & conflict points ----------------
 ('speed_breaker_marked',    'traffic_calming_conflict','Speed breaker (painted)',           'info',    'permanent', NULL, 20, false, 'always',        true,  false, false),
 ('speed_breaker_unmarked',  'traffic_calming_conflict','Unmarked speed breaker',            'critical','permanent', NULL, 20, false, 'always',        true,  true,  false),
 ('rumble_strips',           'traffic_calming_conflict','Rumble strips',                     'info',    'permanent', NULL, 30, false, 'always',        true,  false, false),
 ('unmarked_median_gap',     'traffic_calming_conflict','Median gap: crossing traffic',      'warning', 'permanent', NULL, 30, false, 'always',        true,  false, false),
 ('wrong_side_hot_zone',     'traffic_calming_conflict','Wrong-side traffic common',         'critical','recurring', NULL,200, false, 'always',        true,  false, true ),
 ('near_miss_hotspot',       'traffic_calming_conflict','Frequent hard braking here',        'warning', 'semi',      2160, 50, false, 'always',        true,  false, false),
-- ---------------- Dynamic & environmental ----------------
 ('pothole',                 'dynamic_environmental',   'Pothole',                           'warning', 'semi',       720, 15, false, 'always',        true,  true,  false),
 ('crater_deep_pothole',     'dynamic_environmental',   'Deep crater',                       'critical','semi',       720, 15, false, 'always',        true,  true,  false),
 ('pothole_dense_stretch',   'dynamic_environmental',   'Pothole-dense stretch',             'warning', 'semi',      1440,100, false, 'always',        true,  true,  true ),
 ('stray_cattle_zone',       'dynamic_environmental',   'Cattle on road',                    'warning', 'recurring', NULL,150, false, 'dusk_dawn',     true,  true,  false),
 ('parked_heavy_vehicle',    'dynamic_environmental',   'Parked truck on shoulder',          'critical','transient',   12, 50, true,  'night',         true,  false, false),
 ('waterlogging',            'dynamic_environmental',   'Waterlogged road',                  'warning', 'transient',   48, 50, false, 'always',        true,  true,  false),
 ('oil_spill_loose_gravel',  'dynamic_environmental',   'Oil spill / loose gravel',          'critical','transient',   24, 30, false, 'always',        true,  true,  false),
 ('school_zone',             'dynamic_environmental',   'School crossing',                   'warning', 'recurring', NULL,150, false, 'school_hours',  true,  false, false),
 ('high_pedestrian_zone',    'dynamic_environmental',   'Busy pedestrian crossing',          'warning', 'permanent', NULL, 80, false, 'always',        true,  false, false),
 ('construction_diversion',  'dynamic_environmental',   'Road work / diversion',             'warning', 'transient',  720, 80, false, 'always',        true,  false, false),
 ('fog_prone_stretch',       'dynamic_environmental',   'Fog-prone stretch',                 'warning', 'recurring', NULL,300, false, 'dusk_dawn',     true,  false, true );

-- Regional-language labels: ship with human-recorded voice clips (offline, natural).
INSERT INTO hazard_type_labels (code, lang, label, voice_clip) VALUES
 ('speed_breaker_unmarked','te','ముందు స్పీడ్ బ్రేకర్',        'te/speed_breaker.opus'),
 ('speed_breaker_unmarked','hi','आगे स्पीड ब्रेकर',            'hi/speed_breaker.opus'),
 ('pothole',               'te','ముందు గుంత',                 'te/pothole.opus'),
 ('pothole',               'hi','आगे गड्ढा',                   'hi/pothole.opus'),
 ('crater_deep_pothole',   'te','ముందు లోతైన గుంత, నెమ్మదిగా', 'te/crater.opus'),
 ('hairpin_bend',          'te','ముందు పదునైన మలుపు',          'te/hairpin.opus'),
 ('wrong_side_hot_zone',   'te','ఎదురుగా రాంగ్ సైడ్ వాహనాలు',  'te/wrong_side.opus'),
 ('parked_heavy_vehicle',  'te','రోడ్డు పక్కన లారీ ఆగి ఉంది',   'te/parked_truck.opus'),
 ('stray_cattle_zone',     'te','రోడ్డుపై పశువులు',            'te/cattle.opus');

INSERT INTO sla_policies (severity, acknowledge_hours, resolve_hours, escalate_after_hours) VALUES
 ('critical',  24,  168,  72),   -- ack in 1 day, fix in 7 days, climb a level every 3 days overdue
 ('warning',   72,  720, 168),
 ('info',     168, 2160, 720);
