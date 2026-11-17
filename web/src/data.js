// ---------------------------------------------------------------------------
// REAL, SOURCED FACTS (shown with a "Source" chip in the UI)
// ---------------------------------------------------------------------------
export const SOURCES = {
  morth2024: { label: "MoRTH reply in Parliament, Dec 2025 (PTI)", url: "https://www.theweek.in/wire-updates/business/2025/12/05/dcm19-lsq-road-accidents-gadkari.html" },
  ap2023: { label: "MoRTH, Road Accidents in India 2023 (via Deccan Chronicle)", url: "https://www.deccanchronicle.com/southern-states/andhra-pradesh/2023-report-cites-drop-in-road-accidents-in-ap-1914632" },
  chittoor2024: { label: "AP SCRB data, AP Transport Dept (Jan–Oct 2024)", url: "https://aptransport.org/images/pdf/road-accidents-data-for-october-2024.pdf" },
  blackspots: { label: "MoRTH report Dec 2024 (via Deccan Chronicle)", url: "https://deccanchronicle.com/southern-states/andhra-pradesh/blackspots-on-highways-in-ap-leading-to-avoidable-fatalities-1861446" },
  trauma: { label: "Deccan Chronicle: no highway trauma centres in Chittoor & Tirupati", url: "https://www.deccanchronicle.com/southern-states/andhra-pradesh/chittoor-tirupati-highways-lack-dedicated-trauma-care-facilities-1965701" },
  nagariHospital: { label: "PM-JAY hospital list: Area Hospital-Nagari", url: "https://www.policybazaar.com/hospitals/pmjay/chittoor/" },
  nagariAmbulance: { label: "The Hans India: ALS ambulance at Nagari Area Hospital", url: "https://assets.thehansindia.com/news/cities/tirupathi/nagari-mla-bhanuprakash-inaugurates-ambulance-913652" },
  svims: { label: "SVIMS Dept. of Emergency Medicine", url: "https://svimstpt.ap.nic.in/emd.html" },
  rahat: { label: "PM RAHAT scheme (Feb 2026)", url: "https://www.outlookmoney.com/personal-finance/pm-rahat-scheme-cashless-coverage-of-rs-15-lakh-to-road-victims" },
  hitrun: { label: "Lok Sabha answer on Hit & Run Scheme 2022 (Mar 2025)", url: "https://eparlib.sansad.in/bitstream/123456789/3015489/1/AU2516_XhlarW.pdf" },
  s164: { label: "Section 164 MV Act (₹5L death / ₹2.5L grievous)", url: "https://future.indiankanoon.org/doc/24315214/" },
  s166: { label: "Section 166(3): 6-month limit (Madras HC, 2023)", url: "https://www.livelaw.in/pdf_upload/malaravan-v-praveen-travels-491371.pdf" },
  samaritan: { label: "PIB: Good Samaritan rules (2020)", url: "https://pib.gov.in/PressReleasePage.aspx?PRID=1660551" },
  pranay: { label: "Supreme Court, Aug 2024 (Pranay Sethi method, 10% escalation)", url: "https://api.sci.gov.in/supremecourt/2023/46439/46439_2023_12_1501_54520_Judgement_07-Aug-2024.pdf" },
  telemanas: { label: "Tele-MANAS (MoHFW)", url: "https://en.vikaspedia.in/viewcontent/health/mental-health/tele-manas" },
  nalsa: { label: "NALSA legal aid helpline", url: "https://nalsa.gov.in/promoting-inclusive-legal-system/" },
  ntr: { label: "NTR Bharosa pension (Vikaspedia)", url: "https://en.vikaspedia.in/viewcontent/schemesall/state-specific-schemes/welfare-schemes-of-andhra-pradesh/ntr-bharosa-pension-scheme-of-andhra-pradesh?lgn=en" },
  nh716: { label: "NH 716 (Chennai–Tiruttani–Renigunta)", url: "https://en.wikipedia.com/wiki/Renigunta" },
};

export const REAL_STATS = [
  { k: "India road deaths, 2024", v: "1,77,177", note: "485 every day", src: "morth2024" },
  { k: "Andhra Pradesh deaths, 2023", v: "8,137", note: "19,949 accidents", src: "ap2023" },
  { k: "Chittoor district deaths, Jan–Oct 2024", v: "326", note: "up from 290 in Jan–Oct 2023", src: "chittoor2024" },
  { k: "NH black spots in Chittoor district", v: "41", note: "MoRTH list, Dec 2024", src: "blackspots" },
];

/** Chittoor district, Jan–Oct, real (AP SCRB). */
export const CHITTOOR_YOY = [
  { label: "Accidents", prev: 591, cur: 627 },
  { label: "Injured", prev: 718, cur: 792 },
  { label: "Deaths", prev: 290, cur: 326 },
];

export const HELPLINES = [
  { n: "112", what: "Police, fire, ambulance (ERSS)", note: "Also links you to cashless treatment" },
  { n: "108", what: "Ambulance" },
  { n: "1033", what: "National Highway emergency (NHAI)", note: "For accidents on NH 716" },
  { n: "15100", what: "Free legal aid (NALSA / DLSA)", note: "Free lawyer for the claim", src: "nalsa" },
  { n: "14416", what: "Tele-MANAS: free counselling, 24×7", note: "In Telugu and Tamil too", src: "telemanas" },
];

// ---------------------------------------------------------------------------
// PILOT GEOGRAPHY: Nagari, Chittoor district (schematic positions, not to scale)
// ---------------------------------------------------------------------------
export const PLACES = {
  tirupati: { name: "Tirupati", x: 70, y: 40 },
  renigunta: { name: "Renigunta", x: 175, y: 30 },
  puttur: { name: "Puttur", x: 255, y: 150 },
  nagari: { name: "Nagari", x: 300, y: 250 },
  tiruttani: { name: "Tiruttani (TN)", x: 345, y: 360 },
  karvetinagaram: { name: "Karvetinagaram", x: 130, y: 265 },
};

export const ROADS = [
  { id: "nh716", name: "NH 716", pts: ["renigunta", "puttur", "nagari", "tiruttani"], kind: "nh" },
  { id: "tpt", name: "Tirupati link", pts: ["tirupati", "renigunta"], kind: "nh" },
  { id: "kvn", name: "Nagari–Karvetinagaram Rd", pts: ["nagari", "karvetinagaram"], kind: "sh" },
  { id: "nh716b", name: "NH 716B (under construction)", pts: ["karvetinagaram", "nagari"], kind: "build", offset: 18 },
];

export const HOTSPOTS = [
  { id: "H1", name: "NH 716 near Nagari bypass", x: 290, y: 225, risk: 86, why: "Night speeding, median gaps" },
  { id: "H2", name: "NH 716 Puttur–Nagari stretch", x: 275, y: 195, risk: 74, why: "Parked lorries on shoulder" },
  { id: "H3", name: "NH 716 near AP–TN border", x: 330, y: 330, risk: 69, why: "Wrong-side two-wheelers" },
  { id: "H4", name: "Nagari town, Tirupati Road", x: 305, y: 262, risk: 58, why: "Market-day pedestrians" },
  { id: "H5", name: "Nagari–Karvetinagaram Rd", x: 235, y: 256, risk: 52, why: "Unlit, cattle at dusk" },
];

export const CARE = [
  { name: "Area Hospital, Nagari", where: "Tirupati Road, Nagari", role: "Stabilise first", detail: "Government hospital, PM-JAY empanelled (cashless). Has an advanced life support ambulance.", src: "nagariHospital", tone: "emerald" },
  { name: "SVIMS Emergency Medicine, Tirupati", where: "Alipiri Road, Tirupati", role: "Major trauma", detail: "Handles road-accident trauma and emergencies.", src: "svims", tone: "sky" },
  { name: "SVRR Govt. General Hospital (Ruia), Tirupati", where: "Tirupati", role: "Major trauma", detail: "Main referral hospital for serious crash victims in the region.", src: "trauma", tone: "sky" },
];

// ---------------------------------------------------------------------------
// DEMO DATA (clearly badged "Pilot demo" in the UI)
// ---------------------------------------------------------------------------
const INCIDENT_PLACES = [
  ["NH 716, Nagari bypass", 13.3217, 79.5862],
  ["NH 716, Puttur side", 13.3794, 79.5711],
  ["NH 716, near AP–TN border", 13.2412, 79.6043],
  ["Nagari town, Tirupati Road", 13.3279, 79.5853],
  ["Nagari–Karvetinagaram Rd", 13.3103, 79.5126],
  ["Nindra road junction", 13.3561, 79.6189],
];
const TYPES = ["Two-wheeler skid", "Bike vs lorry", "Auto overturned", "Car rear-ended parked lorry", "Pedestrian hit", "Head-on, two-wheelers"];

let seed = 7;
export function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

export function makeIncident(id, minutesAgo) {
  const p = INCIDENT_PLACES[Math.floor(rnd() * INCIDENT_PLACES.length)];
  const sevRoll = rnd();
  const severity = sevRoll < 0.22 ? "Critical" : sevRoll < 0.6 ? "Serious" : "Minor";
  const t = Date.now() - minutesAgo * 60000;
  const stage = (x) => (minutesAgo > x ? "done" : minutesAgo > x - 8 ? "active" : "waiting");
  return {
    id: `NGR-${id}`,
    at: t,
    place: p[0],
    lat: (p[1] + (rnd() - 0.5) * 0.004).toFixed(4),
    lon: (p[2] + (rnd() - 0.5) * 0.004).toFixed(4),
    type: TYPES[Math.floor(rnd() * TYPES.length)],
    severity,
    injured: severity === "Minor" ? 1 : 1 + Math.floor(rnd() * 3),
    dispatch: {
      ambulance: stage(severity === "Minor" ? 25 : 18),
      police: stage(30),
      tow: severity === "Minor" ? stage(55) : stage(70),
    },
  };
}

export function initialIncidents() {
  return [4, 11, 19, 33, 47, 68].map((m, i) => makeIncident(2411 + i, m));
}

/** Pilot reporting series (demo). */
export const PILOT_SERIES = {
  fortnightly: {
    labels: ["Sep 1–15", "Sep 16–30", "Oct 1–15", "Oct 16–31", "Nov 1–15", "Nov 16–30"],
    prev: [9, 11, 8, 12, 13, 10],
    cur: [8, 9, 9, 10, 7, 6],
    note: "Accidents recorded, Nagari pilot area: this year vs same fortnight last year",
  },
  monthly: {
    labels: ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"],
    prev: [21, 24, 19, 20, 22, 23],
    cur: [22, 20, 18, 17, 19, 13],
    note: "Accidents recorded, Nagari pilot area: 2026 vs 2025",
  },
};

export const KPI_BY_PERIOD = {
  fortnightly: { value: 6, delta: -14 },
  monthly: { value: 13, delta: -24 },
  yearly: { value: 211, delta: -8 },
};

export const HAZARDS = [
  { id: "HZ-118", type: "Unmarked speed breaker", place: "Nagari town, Tirupati Road", owner: "Nagari Municipality", tier: "Community verified", status: "Overdue", days: 19, sla: 7, critical: true },
  { id: "HZ-121", type: "Lorries parked on shoulder at night", place: "NH 716, Puttur–Nagari", owner: "NHAI PIU Chittoor", tier: "Authority verified", status: "Work scheduled", days: 6, sla: 7, critical: true },
  { id: "HZ-124", type: "Deep crater after rain", place: "Nagari–Karvetinagaram Rd", owner: "R&B Division", tier: "Telemetry (12 phones)", status: "Assigned", days: 3, sla: 7, critical: true },
  { id: "HZ-109", type: "Unlit stretch, 800 m", place: "Nagari–Karvetinagaram Rd", owner: "Gram Panchayat", tier: "Community verified", status: "Overdue", days: 41, sla: 30, critical: false },
  { id: "HZ-097", type: "Median gap used for U-turns", place: "NH 716, Nagari bypass", owner: "NHAI PIU Chittoor", tier: "Authority verified", status: "Fixed, riders confirming", days: 26, sla: 30, critical: false },
  { id: "HZ-088", type: "School crossing without zebra", place: "Nagari town", owner: "Nagari Municipality", tier: "Authority verified", status: "Closed", days: 12, sla: 30, critical: false },
];

export const AGENCIES = [
  { name: "NHAI PIU Chittoor", open: 4, overdue: 1, median: 9.5, reopened: 1 },
  { name: "Nagari Municipality", open: 5, overdue: 2, median: 14.0, reopened: 0 },
  { name: "R&B Division", open: 3, overdue: 0, median: 6.0, reopened: 0 },
  { name: "Gram Panchayats (Nagari mandal)", open: 6, overdue: 3, median: 22.5, reopened: 2 },
];

export const CASES = [
  { id: "NGR-2368", stage: 4, mact: true, insurer: "Claim filed", investigation: "Charge sheet filed", days: 63 },
  { id: "NGR-2379", stage: 2, mact: false, insurer: "Awaiting documents", investigation: "Under investigation", days: 41 },
  { id: "NGR-2385", stage: 3, mact: true, insurer: "Survey done", investigation: "Under investigation", days: 30 },
  { id: "NGR-2391", stage: 1, mact: false, insurer: "Not started", investigation: "FIR registered", days: 12 },
];
export const CASE_STAGES = ["FIR", "Accident report to tribunal", "Documents complete", "Claim filed", "Award / settled"];

export const GOLDEN_FUNNEL = [
  { step: "Crash → first call", min: 6 },
  { step: "Call → ambulance on scene", min: 17 },
  { step: "Scene → Nagari Area Hospital", min: 14 },
  { step: "Stabilise → referral out", min: 22 },
  { step: "Transfer → trauma care, Tirupati", min: 58 },
];

export const ROUTES = [
  {
    id: "tpt", name: "Nagari → Tirupati", via: "NH 716 via Puttur",
    day: [
      { sev: "critical", text: "Parked lorries on the shoulder, Puttur–Nagari stretch" },
      { sev: "warning", text: "Median gaps used for U-turns near Nagari bypass" },
      { sev: "warning", text: "Pilgrim traffic peaks on weekends" },
    ],
    night: [
      { sev: "critical", text: "Unlit lorries parked on the shoulder, Puttur–Nagari stretch" },
      { sev: "critical", text: "Speeding on the straight stretch after Puttur" },
      { sev: "warning", text: "Median gaps used for U-turns near Nagari bypass" },
    ],
    tip: "Serious injuries on this route go to Tirupati: SVIMS or Ruia. There is no trauma centre on the highway.",
  },
  {
    id: "ttn", name: "Nagari → Tiruttani / Chennai", via: "NH 716 south",
    day: [
      { sev: "warning", text: "Wrong-side two-wheelers near the AP–TN border" },
      { sev: "warning", text: "Market-day pedestrians, Nagari town" },
    ],
    night: [
      { sev: "critical", text: "Wrong-side two-wheelers near the AP–TN border" },
      { sev: "warning", text: "Poor lighting south of Nagari" },
    ],
    tip: "Across the border, dial 112 in Tamil Nadu too. Cashless treatment (PM RAHAT) works on any road in India.",
  },
  {
    id: "kvn", name: "Nagari → Karvetinagaram", via: "District road",
    day: [
      { sev: "critical", text: "Deep crater after rain, reported by 12 phones" },
      { sev: "info", text: "Narrow culverts, slow down for oncoming buses" },
    ],
    night: [
      { sev: "critical", text: "Unlit 800 m stretch, cattle on road after dusk" },
      { sev: "critical", text: "Deep crater after rain, reported by 12 phones" },
    ],
    tip: "Expressway (NH 716B) construction works ahead: expect diversions.",
  },
];
