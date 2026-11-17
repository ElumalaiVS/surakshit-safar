import React, { useEffect, useMemo, useState } from "react";
import { Card, Badge, DemoBadge, Disclosure, Segmented, Source, useCopy, inr, lakh } from "./ui.jsx";
import { t } from "./i18n.js";
import { CARE, HELPLINES, ROUTES, HAZARDS } from "./data.js";
import { estimateDeathClaim } from "./estimator.js";

// ============================================================ Emergency mode
export function Emergency({ lang }) {
  const [landmark, setLandmark] = useState("");
  const [copied, copy] = useCopy();
  const msg = `URGENT: Road accident near ${landmark || "Nagari"} (Nagari, Chittoor dist.). Please call 108 / 112 and come. I am with the injured person.`;
  return (
    <Card tone="alert" id="help" eyebrow="Emergency" title={t("helpNow", lang)}>
      <p className="mb-5 max-w-prose text-slate-300">{t("helpNowSub", lang)}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {HELPLINES.slice(0, 3).map((h) => (
          <a key={h.n} href={`tel:${h.n}`}
             className="group flex items-center justify-between rounded-xl bg-rose-600 px-4 py-3 text-white shadow-lg shadow-rose-950/40 transition hover:bg-rose-500 focus-ring">
            <span>
              <span className="block font-display text-3xl font-bold tabular leading-none">{h.n}</span>
              <span className="mt-1 block text-xs text-rose-100">{h.what}</span>
            </span>
            <svg className="h-7 w-7 opacity-80 transition group-hover:scale-110" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" /></svg>
          </a>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-400">If the call button does not open your dialler, dial the number shown.</p>

      <div className="mt-6 grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3 space-y-3">
          <h3 className="font-semibold text-slate-100">{t("whereToGo", lang)}</h3>
          <ol className="space-y-2">
            {CARE.map((c, i) => (
              <li key={c.name} className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                <span className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-bold ${i === 0 ? "bg-emerald-500 text-slate-950" : "bg-sky-500 text-slate-950"}`}>{i + 1}</span>
                <div className="min-w-0">
                  <p className="font-medium text-slate-100">{c.name} <span className="ml-1 text-xs font-normal text-slate-400">· {c.role}</span></p>
                  <p className="text-sm text-slate-400">{c.detail}</p>
                  <Source id={c.src} />
                </div>
              </li>
            ))}
          </ol>
          <p className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-100 ring-1 ring-inset ring-amber-500/30">
            {t("traumaGap", lang)} <Source id="trauma" />
          </p>
        </div>
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/20 p-4">
            <h3 className="mb-2 font-semibold text-emerald-200">{t("samaritanTitle", lang)}</h3>
            <ul className="space-y-1.5 text-sm text-slate-200">
              {["samaritan1", "samaritan2", "samaritan3"].map((k) => (
                <li key={k} className="flex gap-2"><span className="text-emerald-400" aria-hidden="true">✓</span>{t(k, lang)}</li>
              ))}
            </ul>
            <div className="mt-2"><Source id="samaritan" /></div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <label htmlFor="landmark" className="mb-2 block font-semibold text-slate-100">{t("sosTitle", lang)}</label>
            <input id="landmark" value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder={t("sosLandmark", lang)}
                   className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-ring" />
            <p className="mt-2 rounded-lg bg-slate-900 p-2 text-xs text-slate-300">{msg}</p>
            <button type="button" onClick={() => copy(msg)} className="mt-2 rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-white focus-ring">
              {t("copyMsg", lang)}
            </button>
            {copied === true && <p className="mt-1 text-xs text-emerald-300" role="status">{t("copied", lang)}</p>}
            {copied === "fail" && <p className="mt-1 text-xs text-amber-300" role="status">Copy was blocked. Select the text above and copy it.</p>}
          </div>
        </div>
      </div>

      <div className="mt-5">
        <Disclosure title={t("firstAid", lang)} accent="rose">
          <div className="grid gap-4 sm:grid-cols-2">
            <ul className="space-y-1.5">
              <li className="font-semibold text-emerald-300">Do</li>
              <li>Switch on hazard lights and warn oncoming traffic.</li>
              <li>Press firmly on bleeding with a clean cloth.</li>
              <li>Keep the person still, warm, and talk to them.</li>
              <li>Note the time of the crash and the vehicle number.</li>
            </ul>
            <ul className="space-y-1.5">
              <li className="font-semibold text-rose-300">Don't</li>
              <li>Don't pull off a rider's helmet unless they cannot breathe.</li>
              <li>Don't move them unless there is fire or traffic danger.</li>
              <li>Don't give food or water.</li>
              <li>Don't crowd around; give them air and space.</li>
            </ul>
          </div>
        </Disclosure>
      </div>
    </Card>
  );
}

// ============================================================ Service tiles
export function Services({ lang }) {
  const tiles = [
    { href: "#family", k: "svcFamily", tone: "from-emerald-500/20", icon: "M12 21s-7-4.4-9.3-8.5C1 9.4 3 6 6.3 6c2 0 3.3 1 3.7 2 .4-1 1.7-2 3.7-2C17 6 19 9.4 17.3 12.5 15 16.6 12 21 12 21z" },
    { href: "#route", k: "svcRoute", tone: "from-sky-500/20", icon: "M4 19l5-14 6 9 5-5" },
    { href: "#report", k: "svcReport", tone: "from-amber-500/20", icon: "M12 3l9 16H3zM12 10v4M12 17v.5" },
    { href: "#ledger", k: "svcTrack", tone: "from-violet-500/20", icon: "M4 6h16M4 12h10M4 18h7M17 15l2 2 3-4" },
  ];
  return (
    <div>
      <h2 className="mb-3 font-display text-lg font-semibold text-slate-100">{t("services", lang)}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((x) => (
          <a key={x.href} href={x.href} onClick={(e) => { e.preventDefault(); document.querySelector(x.href)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
             className={`group flex min-h-[112px] flex-col justify-between rounded-2xl border border-slate-800 bg-gradient-to-br ${x.tone} to-slate-900 p-4 transition hover:-translate-y-0.5 hover:border-slate-600 focus-ring`}>
            <svg className="h-6 w-6 text-slate-200" viewBox="0 0 24 24" aria-hidden="true"><path d={x.icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span className="font-medium leading-snug text-slate-100">{t(x.k, lang)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

// ============================================================ Family companion
const STEPS = [
  // phase, id, when(outcome, vehicle) -> bool, text {en,te,ta}
  ["week", "rahat", (o) => o === "injured", {
    en: "Get treatment free under PM RAHAT: up to ₹1.5 lakh, for 7 days. Nagari Area Hospital is empanelled.",
    te: "PM RAHAT కింద ఉచిత చికిత్స: 7 రోజుల్లో ₹1.5 లక్షల వరకు. నగరి ఏరియా ఆసుపత్రిలో లభిస్తుంది.",
    ta: "PM RAHAT மூலம் இலவச சிகிச்சை: 7 நாட்களுக்கு ₹1.5 லட்சம் வரை. நகரி அரசு மருத்துவமனையில் கிடைக்கும்." }],
  ["week", "fir", () => true, {
    en: "Get a copy of the FIR from the police station. It is free.",
    te: "పోలీస్ స్టేషన్ నుంచి FIR కాపీ తీసుకోండి. ఇది ఉచితం.",
    ta: "காவல் நிலையத்தில் FIR நகலைப் பெறுங்கள். இது இலவசம்." }],
  ["week", "veh", (o, v) => v !== "hitrun", {
    en: "Ask police for the other vehicle's number, owner and insurance details.",
    te: "ఢీకొట్టిన వాహనం నంబర్, యజమాని, ఇన్సూరెన్స్ వివరాలు పోలీసుల నుంచి తీసుకోండి.",
    ta: "மோதிய வாகனத்தின் எண், உரிமையாளர், காப்பீட்டு விவரங்களை காவல்துறையிடம் கேளுங்கள்." }],
  ["week", "hr", (o, v) => v === "hitrun", {
    en: "Make sure the FIR records it as a hit-and-run.",
    te: "FIR లో 'హిట్ అండ్ రన్' అని నమోదు అయిందో చూడండి.",
    ta: "FIR-ல் 'மோதிவிட்டு ஓடியது' என பதிவாகியுள்ளதா என உறுதிசெய்யுங்கள்." }],
  ["week", "pm", (o) => o === "died", {
    en: "Collect the post-mortem report and the spot panchanama (mahazar) from police.",
    te: "పోస్ట్‌మార్టం రిపోర్ట్, స్పాట్ పంచనామా కాపీలు పోలీసుల నుంచి తీసుకోండి.",
    ta: "பிரேத பரிசோதனை அறிக்கை, சம்பவ இட மகசர் நகல்களை காவல்துறையிடம் பெறுங்கள்." }],
  ["week", "bills", (o) => o === "injured", {
    en: "Keep every hospital bill, discharge summary and medical certificate.",
    te: "ప్రతి ఆసుపత్రి బిల్లు, డిశ్చార్జ్ సమ్మరీ, మెడికల్ సర్టిఫికెట్ దాచుకోండి.",
    ta: "ஒவ்வொரு மருத்துவ பில், டிஸ்சார்ஜ் சுருக்கம், மருத்துவ சான்றிதழை பத்திரப்படுத்துங்கள்." }],
  ["month", "dc", (o) => o === "died", {
    en: "Death certificate from Nagari Municipality or the Gram Panchayat.",
    te: "నగరి మున్సిపాలిటీ లేదా గ్రామ పంచాయతీ నుంచి మరణ ధృవీకరణ పత్రం.",
    ta: "நகரி நகராட்சி அல்லது கிராம ஊராட்சியிடமிருந்து இறப்புச் சான்றிதழ்." }],
  ["month", "fmc", (o) => o === "died", {
    en: "Family member certificate from the MRO / Tahsildar office (MeeSeva).",
    te: "MRO / తహసీల్దార్ కార్యాలయం నుంచి కుటుంబ సభ్యుల ధృవీకరణ పత్రం (మీసేవ).",
    ta: "MRO / வட்டாட்சியர் அலுவலகத்திலிருந்து குடும்ப உறுப்பினர் சான்றிதழ் (மீசேவா)." }],
  ["month", "inc", () => true, {
    en: "Gather income proof: salary slips, bank statements or an employer letter. Farmers and daily-wage workers: ask legal aid how to prove income.",
    te: "ఆదాయ రుజువులు: జీతం స్లిప్పులు, బ్యాంక్ స్టేట్‌మెంట్లు. రైతులు, కూలీలు ఆదాయం ఎలా చూపించాలో లీగల్ ఎయిడ్‌ను అడగండి.",
    ta: "வருமான ஆதாரம்: சம்பளச் சீட்டு, வங்கி அறிக்கை. விவசாயிகள், கூலித் தொழிலாளர்கள் வருமானத்தை எப்படி நிரூபிப்பது என சட்ட உதவியிடம் கேளுங்கள்." }],
  ["month", "age", () => true, {
    en: "Age proof: Aadhaar or school certificate.",
    te: "వయసు రుజువు: ఆధార్ లేదా స్కూల్ సర్టిఫికెట్.",
    ta: "வயது ஆதாரம்: ஆதார் அல்லது பள்ளிச் சான்றிதழ்." }],
  ["month", "dar", (o, v) => v !== "hitrun", {
    en: "Ask police whether the accident report (DAR) has been sent to the Claims Tribunal.",
    te: "ప్రమాద నివేదిక (DAR) క్లెయిమ్స్ ట్రిబ్యునల్‌కు పంపారో లేదో పోలీసులను అడగండి.",
    ta: "விபத்து அறிக்கை (DAR) இழப்பீட்டு தீர்ப்பாயத்துக்கு அனுப்பப்பட்டதா என காவல்துறையிடம் கேளுங்கள்." }],
  ["month", "aid", () => true, {
    en: "Call 15100 or visit the District Legal Services Authority for a free lawyer.",
    te: "ఉచిత న్యాయవాది కోసం 15100 కు కాల్ చేయండి లేదా జిల్లా న్యాయ సేవా సంస్థకు వెళ్లండి.",
    ta: "இலவச வழக்கறிஞருக்கு 15100 அழையுங்கள் அல்லது மாவட்ட சட்டப் பணிகள் ஆணையத்துக்குச் செல்லுங்கள்." }],
  ["deadline", "mact", (o, v) => v !== "hitrun", {
    en: "File the claim at the Motor Accident Claims Tribunal (MACT) within 6 months of the accident.",
    te: "ప్రమాదం జరిగిన 6 నెలల్లోపు మోటార్ యాక్సిడెంట్ క్లెయిమ్స్ ట్రిబ్యునల్ (MACT) లో క్లెయిమ్ వేయండి.",
    ta: "விபத்து நடந்த 6 மாதங்களுக்குள் மோட்டார் விபத்து இழப்பீட்டு தீர்ப்பாயத்தில் (MACT) மனு தாக்கல் செய்யுங்கள்." }],
  ["deadline", "hrapp", (o, v) => v !== "known", {
    en: "Hit-and-run: apply for fixed compensation (₹2 lakh for a death, ₹50,000 for grievous injury). Ask at the RDO / Tahsildar office; police and legal aid can help.",
    te: "హిట్ అండ్ రన్: స్థిర పరిహారం (మరణానికి ₹2 లక్షలు, తీవ్ర గాయానికి ₹50,000) కోసం దరఖాస్తు చేయండి. RDO / తహసీల్దార్ కార్యాలయంలో అడగండి.",
    ta: "மோதிவிட்டு ஓடிய வழக்கு: நிலையான இழப்பீடு (இறப்புக்கு ₹2 லட்சம், கடுங்காயத்துக்கு ₹50,000) கோரி விண்ணப்பியுங்கள். RDO / வட்டாட்சியர் அலுவலகத்தில் கேளுங்கள்." }],
  ["deadline", "nosign", () => true, {
    en: "Do not sign any settlement or blank paper before talking to legal aid.",
    te: "లీగల్ ఎయిడ్‌తో మాట్లాడకముందు ఏ ఒప్పందం లేదా ఖాళీ కాగితంపై సంతకం చేయవద్దు.",
    ta: "சட்ட உதவியிடம் பேசும் முன் எந்த ஒப்பந்தத்திலும் வெற்றுத் தாளிலும் கையெழுத்திடாதீர்கள்." }],
  ["support", "pension", (o) => o === "died", {
    en: "Widow pension (NTR Bharosa, ₹4,000 a month): apply at the Grama / Ward Sachivalayam with the death certificate.",
    te: "వితంతు పింఛను (NTR భరోసా, నెలకు ₹4,000): మరణ ధృవీకరణ పత్రంతో గ్రామ / వార్డు సచివాలయంలో దరఖాస్తు చేయండి.",
    ta: "விதவை ஓய்வூதியம் (NTR பரோசா, மாதம் ₹4,000): இறப்புச் சான்றிதழுடன் கிராம / வார்டு சச்சிவாலயத்தில் விண்ணப்பியுங்கள்." }],
  ["support", "talk", () => true, {
    en: "Grief is heavy. Tele-MANAS (14416) offers free counselling, any time, in Telugu and Tamil.",
    te: "దుఃఖం భారంగా ఉంటుంది. టెలి-మానస్ (14416) లో ఎప్పుడైనా ఉచిత కౌన్సెలింగ్, తెలుగులో కూడా.",
    ta: "துயரம் கனமானது. டெலி-மானஸ் (14416) எப்போதும் இலவச ஆலோசனை தருகிறது, தமிழிலும்." }],
];
const PHASES = [
  ["week", "First 7 days"],
  ["month", "Within the first month"],
  ["deadline", "Before the deadline"],
  ["support", "Support for the family"],
];

function loadChecks() {
  try { return JSON.parse(localStorage.getItem("sg-checks") || "{}"); } catch { return {}; }
}

function addMonths(d, m) { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; }
function daysBetween(a, b) { return Math.ceil((b - a) / 86400000); }
const fmt = (d) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function FamilyCompanion({ lang }) {
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  const [date, setDate] = useState(tenDaysAgo);
  const [outcome, setOutcome] = useState("died");
  const [vehicle, setVehicle] = useState("known");
  const [checks, setChecks] = useState(loadChecks);
  const [copied, copy] = useCopy();

  useEffect(() => { try { localStorage.setItem("sg-checks", JSON.stringify(checks)); } catch { /* storage unavailable */ } }, [checks]);

  const acc = new Date(date + "T00:00:00");
  const today = new Date(new Date().toDateString());
  const rahatEnd = new Date(acc.getTime() + 7 * 86400000);
  const mactEnd = addMonths(acc, 6);
  const rahatLeft = daysBetween(today, rahatEnd);
  const mactLeft = daysBetween(today, mactEnd);
  const elapsed = Math.max(0, daysBetween(acc, today));

  const steps = STEPS.filter(([, , when]) => when(outcome, vehicle));
  const done = steps.filter(([, id]) => checks[id]).length;
  const listText = steps.map(([, id, , txt]) => `${checks[id] ? "[x]" : "[ ]"} ${txt[lang] || txt.en}`).join("\n");

  return (
    <Card id="family" tone="calm" eyebrow="Family rights & legal support" title={t("famTitle", lang)}>
      <p className="mb-5 max-w-prose leading-relaxed text-slate-300">{t("famIntro", lang)}</p>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label htmlFor="accdate" className="mb-1.5 block text-sm text-slate-400">{t("accDate", lang)}</label>
          <input id="accdate" type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => e.target.value && setDate(e.target.value)}
                 className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus-ring [color-scheme:dark]" />
        </div>
        <div>
          <p className="mb-1.5 text-sm text-slate-400" id="outcome-l">{t("outcome", lang)}</p>
          <Segmented label={t("outcome", lang)} value={outcome} onChange={setOutcome}
            options={[{ id: "injured", label: t("injured", lang) }, { id: "died", label: t("died", lang) }]} />
        </div>
        <div>
          <p className="mb-1.5 text-sm text-slate-400">{t("vehicle", lang)}</p>
          <Segmented label={t("vehicle", lang)} value={vehicle} onChange={setVehicle} size="sm"
            options={[{ id: "known", label: t("vKnown", lang) }, { id: "hitrun", label: t("vHitRun", lang) }, { id: "unsure", label: t("vUnsure", lang) }]} />
        </div>
      </div>

      {/* ---- deadlines */}
      <h3 className="mt-7 mb-3 font-semibold text-slate-100">{t("deadlines", lang)}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {outcome === "injured" && (
          <Deadline title="Cashless treatment (PM RAHAT)" end={rahatEnd} left={rahatLeft} total={7} elapsed={elapsed}
            pastText="The 7-day cashless window has ended. Keep all bills: they count in the compensation claim." src="rahat" />
        )}
        {vehicle !== "hitrun" ? (
          <Deadline title="File the claim at the Claims Tribunal (MACT)" end={mactEnd} left={mactLeft} total={daysBetween(acc, mactEnd)} elapsed={elapsed}
            pastText="Six months have passed. Some High Courts have still allowed late claims, so call free legal aid (15100) today." src="s166" />
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <p className="font-medium text-slate-100">Hit-and-run compensation</p>
            <p className="mt-1 text-sm text-slate-300">A fixed ₹2 lakh for a death, ₹50,000 for grievous injury, paid by the government fund. Apply as soon as you have the FIR and medical / post-mortem papers.</p>
            <div className="mt-2"><Source id="hitrun" /></div>
          </div>
        )}
      </div>

      {/* ---- roadmap */}
      <div className="mt-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-100">{t("roadmap", lang)}</h3>
          <p className="text-xs text-slate-400">{t("saved", lang)}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm tabular text-slate-300">{done}/{steps.length}</span>
          <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
          <button type="button" onClick={() => copy(listText)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 focus-ring">
            {t("copyList", lang)}
          </button>
        </div>
      </div>
      {copied === true && <p className="mt-1 text-xs text-emerald-300" role="status">{t("copied", lang)}</p>}
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        {PHASES.map(([ph, name]) => {
          const items = steps.filter(([p]) => p === ph);
          if (!items.length) return null;
          return (
            <div key={ph} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-300/90">{name}</p>
              <ul className="space-y-2">
                {items.map(([, id, , txt]) => (
                  <li key={id}>
                    <label htmlFor={`chk-${id}`} className="flex cursor-pointer gap-3 rounded-lg p-1.5 hover:bg-slate-900">
                      <input id={`chk-${id}`} type="checkbox" checked={!!checks[id]} onChange={(e) => setChecks({ ...checks, [id]: e.target.checked })}
                             className="mt-0.5 h-5 w-5 flex-none rounded border-slate-600 bg-slate-900 accent-emerald-500" />
                      <span className={`text-sm leading-relaxed ${checks[id] ? "text-slate-500 line-through" : "text-slate-200"}`}>{txt[lang] || txt.en}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* ---- compensation */}
      <h3 className="mt-8 mb-3 font-semibold text-slate-100">{t("estimator", lang)}</h3>
      {outcome === "died" ? <Estimator accidentYear={acc.getFullYear()} hitrun={vehicle === "hitrun"} />
        : <InjuryCompensation hitrun={vehicle === "hitrun"} />}

      {/* ---- rights */}
      <h3 className="mt-8 mb-3 font-semibold text-slate-100">{t("rights", lang)}</h3>
      <Rights />

      {/* ---- support */}
      <h3 className="mt-8 mb-3 font-semibold text-slate-100">{t("talk", lang)}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {HELPLINES.map((h) => (
          <a key={h.n} href={`tel:${h.n}`} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 hover:border-slate-600 focus-ring">
            <span className="block font-display text-2xl font-bold tabular text-slate-50">{h.n}</span>
            <span className="block text-sm text-slate-300">{h.what}</span>
            {h.note && <span className="mt-0.5 block text-xs text-slate-500">{h.note}</span>}
          </a>
        ))}
      </div>
    </Card>
  );
}

function Deadline({ title, end, left, total, elapsed, pastText, src }) {
  const past = left < 0;
  const frac = Math.min(1, Math.max(0, elapsed / Math.max(1, total)));
  const urgent = !past && left <= Math.max(3, total * 0.2);
  return (
    <div className={`rounded-xl border p-4 ${past ? "border-rose-900/60 bg-rose-950/20" : urgent ? "border-amber-800/60 bg-amber-950/10" : "border-slate-800 bg-slate-950/50"}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-slate-100">{title}</p>
        {past ? <Badge kind="critical">Passed</Badge> : urgent ? <Badge kind="warning">{left} days left</Badge> : <Badge kind="good">{left} days left</Badge>}
      </div>
      <p className="mt-1 text-sm text-slate-400">Last date: <span className="tabular text-slate-200">{fmt(end)}</span></p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
        <div className={`h-full rounded-full ${past ? "bg-rose-500" : urgent ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${frac * 100}%` }} />
      </div>
      {past && <p className="mt-2 text-sm text-rose-100">{pastText}</p>}
      <div className="mt-2"><Source id={src} /></div>
    </div>
  );
}

function Estimator({ accidentYear, hitrun }) {
  const [age, setAge] = useState(34);
  const [income, setIncome] = useState(15000);
  const [employment, setEmployment] = useState("other");
  const [married, setMarried] = useState(true);
  const [deps, setDeps] = useState(3);

  const notEarning = employment === "none";
  const r = useMemo(() => estimateDeathClaim({ age, monthlyIncome: income, employment, married, dependants: deps, accidentYear }),
    [age, income, employment, married, deps, accidentYear]);

  if (hitrun) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-sm text-slate-300">
        When the vehicle is never traced, the family receives a fixed <b className="text-slate-100">₹2,00,000</b> from the government fund under the Hit-and-Run Scheme. If police later trace the vehicle, a full claim at the tribunal becomes possible, so keep checking with them. <Source id="hitrun" />
      </div>
    );
  }
  const maxBar = Math.max(r.high, 500000);
  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <form className="space-y-4 lg:col-span-2" onSubmit={(e) => e.preventDefault()}>
        <NumField id="est-age" label="Age of the person who died" value={age} setValue={setAge} min={15} max={80} />
        <div>
          <p className="mb-1.5 text-sm text-slate-400">Work</p>
          <Segmented label="Work" value={employment} onChange={setEmployment} size="sm"
            options={[{ id: "permanent", label: "Permanent job" }, { id: "other", label: "Self-employed / daily wage" }, { id: "none", label: "Homemaker / student" }]} />
        </div>
        {!notEarning && <NumField id="est-income" label="Monthly income (₹)" value={income} setValue={setIncome} min={0} max={500000} step={500} />}
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="mb-1.5 text-sm text-slate-400">Married</p>
            <Segmented label="Married" value={married ? "y" : "n"} onChange={(v) => setMarried(v === "y")} size="sm"
              options={[{ id: "y", label: "Yes" }, { id: "n", label: "No" }]} />
          </div>
          <NumField id="est-deps" label="Dependants (spouse, children, parents)" value={deps} setValue={setDeps} min={1} max={10} />
        </div>
      </form>

      <div className="lg:col-span-3 rounded-xl border border-emerald-900/50 bg-slate-950/60 p-5">
        {notEarning ? (
          <div className="space-y-3 text-sm text-slate-300">
            <p className="text-base text-slate-100">Tribunals recognise the value of homemakers, students and children.</p>
            <p>For people without a salary, tribunals use a notional income, and awards vary widely between cases. Free legal aid (15100) can tell you what tribunals in Chittoor district have awarded in similar cases. Fixed heads such as funeral expenses ({inr(r.conventional.funeral)}) and loss of consortium ({inr(r.conventional.consortiumEach)} per dependant) still apply.</p>
            <p>The no-fault route pays a fixed <b className="text-slate-100">₹5,00,000</b> without proving the other driver's fault. <Source id="s164" /></p>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-400">Indicative full claim (Section 166), {accidentYear} accident</p>
            <p className="mt-1 font-display text-3xl font-bold tabular text-emerald-300 sm:text-4xl">{lakh(r.low)} – {lakh(r.high)}</p>
            <p className="mt-1 text-xs text-slate-400">Lower end assumes income is only partly proven and no future-prospects addition.</p>

            <div className="mt-4 space-y-2" aria-label="Comparison of the two routes">
              <CompareBar label="Full claim (Sec. 166), estimate" from={r.low} to={r.high} max={maxBar} color="bg-emerald-500" />
              <CompareBar label="No-fault fixed sum (Sec. 164)" from={0} to={500000} max={maxBar} color="bg-slate-400" solid />
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm tabular">
              <Row k="Annual income" v={inr(r.inputs.annual)} />
              <Row k="Future prospects" v={`+${Math.round(r.futureProspects * 100)}%`} />
              <Row k="Less personal expenses" v={`−${Math.round(r.personalDeduction * 100)}%`} />
              <Row k="Multiplier (by age)" v={`× ${r.multiplier}`} />
              <Row k="Loss of dependency" v={inr(r.lossOfDependency)} strong />
              <Row k="Loss of estate" v={inr(r.conventional.lossOfEstate)} />
              <Row k="Funeral expenses" v={inr(r.conventional.funeral)} />
              <Row k={`Consortium (${r.inputs.dependants} × ${inr(r.conventional.consortiumEach)})`} v={inr(r.conventional.consortium)} />
            </dl>
          </>
        )}
        <div className="mt-5 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-100 ring-1 ring-inset ring-amber-500/30">
          <b>This is an estimate, not legal advice.</b> The two routes are generally alternatives: take advice from free legal aid (15100) before accepting either, and before signing any settlement. Tribunals may also add interest.
        </div>
        <p className="mt-2 text-xs text-slate-500">Method: Sarla Verma multipliers and Pranay Sethi heads, enhanced 10% every 3 years from 2017. <Source id="pranay" /></p>
      </div>
    </div>
  );
}

function InjuryCompensation({ hitrun }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Fact big="₹1.5 lakh" title="Cashless treatment" text="For the first 7 days, on any road, at PM-JAY hospitals. No advance payment." src="rahat" />
      {hitrun ? <Fact big="₹50,000" title="Hit-and-run, grievous injury" text="Fixed sum from the government fund when the vehicle is not traced." src="hitrun" />
        : <Fact big="₹2.5 lakh" title="No-fault, grievous injury" text="Fixed sum without proving the driver's fault (Section 164)." src="s164" />}
      <Fact big="Full claim" title="Section 166 at MACT" text="Covers medical costs, lost earnings, future loss from disability and pain and suffering. Usually higher; needs proof of fault." src="s166" />
    </div>
  );
}

function Fact({ big, title, text, src }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
      <p className="font-display text-2xl font-bold text-emerald-300 tabular">{big}</p>
      <p className="mt-1 font-medium text-slate-100">{title}</p>
      <p className="mt-1 text-sm text-slate-400">{text}</p>
      <div className="mt-2"><Source id={src} /></div>
    </div>
  );
}

function CompareBar({ label, from, to, max, color, solid }) {
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-xs text-slate-400"><span>{label}</span><span className="tabular text-slate-200">{solid ? lakh(to) : `${lakh(from)} – ${lakh(to)}`}</span></div>
      <div className="relative h-3 rounded-full bg-slate-800">
        <div className={`absolute inset-y-0 rounded-full ${color} ${solid ? "" : "opacity-90"}`} style={{ left: `${(from / max) * 100}%`, width: `${((to - from) / max) * 100}%` }} />
      </div>
    </div>
  );
}

function Row({ k, v, strong }) {
  return (<><dt className="text-slate-400">{k}</dt><dd className={`text-right ${strong ? "font-semibold text-slate-50" : "text-slate-200"}`}>{v}</dd></>);
}

function NumField({ id, label, value, setValue, min, max, step = 1 }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm text-slate-400">{label}</label>
      <input id={id} type="number" inputMode="numeric" value={value} min={min} max={max} step={step}
             onChange={(e) => { const n = Number(e.target.value); if (!Number.isNaN(n)) setValue(Math.min(max, Math.max(min, n))); }}
             className="w-full max-w-[12rem] rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 tabular text-slate-100 focus-ring" />
    </div>
  );
}

function Rights() {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Disclosure title="Free treatment in the first 7 days" defaultOpen>
        <p>Every road-accident victim can get cashless treatment up to ₹1.5 lakh for 7 days from the accident, on any road, under PM RAHAT. It is linked to the 112 emergency number. The hospital bills the government; you should not be asked to pay up front.</p>
        <Source id="rahat" />
      </Disclosure>
      <Disclosure title="A free copy of the FIR">
        <p>Whoever reports the accident is entitled to a free copy of the FIR. You need it for treatment, insurance and every compensation route. If police delay, legal aid can step in.</p>
      </Disclosure>
      <Disclosure title="No-fault compensation: ₹5 lakh (death), ₹2.5 lakh (grievous)">
        <p>Under Section 164 of the Motor Vehicles Act you do not have to prove the driver was at fault. It is quicker, but it is a fixed amount and usually less than a full claim. Decide with a lawyer.</p>
        <Source id="s164" />
      </Disclosure>
      <Disclosure title="Full claim at the tribunal: file within 6 months" accent="amber">
        <p>A claim under Section 166 is based on the person's income, age and dependants, and is usually much higher. Since April 2022 the law says it should be filed within six months of the accident. Some High Courts have allowed late claims, but do not rely on that.</p>
        <Source id="s166" />
      </Disclosure>
      <Disclosure title="Hit and run: ₹2 lakh (death), ₹50,000 (grievous)">
        <p>When the vehicle cannot be traced, a fixed sum is paid from the government's Motor Vehicle Accident Fund under the Hit-and-Run Scheme 2022. Very few eligible families apply, so please do.</p>
        <Source id="hitrun" />
      </Disclosure>
      <Disclosure title="Free legal aid">
        <p>The District Legal Services Authority gives a free lawyer to people who cannot afford one, including for accident claims. Call 15100 or apply on plain paper at the district court complex.</p>
        <Source id="nalsa" />
      </Disclosure>
      <Disclosure title="Widow pension in Andhra Pradesh">
        <p>Under NTR Bharosa, eligible widows receive ₹4,000 a month. Apply at the Grama or Ward Sachivalayam with the spouse's death certificate.</p>
        <Source id="ntr" />
      </Disclosure>
      <Disclosure title="Watch out for agents" accent="rose">
        <p>Agents sometimes visit grieving families offering to "handle everything" for a large cut. You never need to pay anyone to file a claim. Legal aid is free. Never sign blank papers.</p>
      </Disclosure>
    </div>
  );
}

// ============================================================ Route check
export function RouteCheck({ lang }) {
  const [route, setRoute] = useState(ROUTES[0].id);
  const [tod, setTod] = useState(new Date().getHours() >= 18 || new Date().getHours() < 6 ? "night" : "day");
  const r = ROUTES.find((x) => x.id === route);
  const items = r[tod];
  return (
    <Card id="route" eyebrow="Before you travel" title={t("routeTitle", lang)} right={<DemoBadge />}>
      <div className="flex flex-wrap gap-3">
        <Segmented label="Route" value={route} onChange={setRoute} size="sm" options={ROUTES.map((x) => ({ id: x.id, label: x.name }))} />
        <Segmented label="Time" value={tod} onChange={setTod} size="sm" options={[{ id: "day", label: t("day", lang) }, { id: "night", label: t("night", lang) }]} />
      </div>
      <p className="mt-4 text-sm text-slate-400">{r.via}</p>
      <ul className="mt-2 space-y-2">
        {items.map((h) => (
          <li key={h.text} className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <Badge kind={h.sev}>{h.sev === "critical" ? "Critical" : h.sev === "warning" ? "Caution" : "Info"}</Badge>
            <span className="text-sm text-slate-200">{h.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-slate-300">{r.tip}</p>
      <p className="mt-3 text-xs text-slate-500">In the SafeGuard rider app, these hazards are spoken aloud as you approach them.</p>
    </Card>
  );
}

// ============================================================ Report + ledger
const PIPE = ["Reported", "Verified", "Assigned", "Fixed", "Confirmed"];
const stageOf = (s) => ({ "Reported (unverified)": 0, Assigned: 2, Overdue: 2, "Work scheduled": 2, "Fixed, riders confirming": 3, Closed: 4 }[s] ?? 1);

export function HazardDesk({ lang }) {
  const [list, setList] = useState(HAZARDS);
  const [type, setType] = useState("Pothole");
  const [place, setPlace] = useState("");
  const [sent, setSent] = useState(false);
  const submit = (e) => {
    e.preventDefault();
    if (!place.trim()) return;
    setList([{ id: `HZ-${130 + list.length}`, type, place: place.trim(), owner: "Routing to owner…", tier: "You (unverified)", status: "Reported (unverified)", days: 0, sla: 7, critical: false }, ...list]);
    setPlace(""); setSent(true); setTimeout(() => setSent(false), 3000);
  };
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card id="report" className="lg:col-span-2" eyebrow="Citizen reporting" title={t("reportTitle", lang)}>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor="hz-type" className="mb-1.5 block text-sm text-slate-400">What is it?</label>
            <select id="hz-type" value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus-ring">
              {["Pothole", "Unmarked speed breaker", "Lorry parked on the road at night", "Street light not working", "Cattle on road", "Missing sign / broken barrier", "Waterlogging"].map((x) => <option key={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="hz-place" className="mb-1.5 block text-sm text-slate-400">Where? (landmark)</label>
            <input id="hz-place" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. near Nagari bus stand"
                   className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus-ring" />
          </div>
          <button type="submit" className="w-full rounded-lg bg-amber-400 px-4 py-2.5 font-semibold text-slate-950 hover:bg-amber-300 focus-ring">Send report</button>
          {sent && <p className="text-sm text-emerald-300" role="status">Thank you. It's on the board. Two more people nearby confirming it sends it to the owning office.</p>}
          <p className="text-xs text-slate-500">Demo: reports stay in this browser. In the pilot they go to the agency that owns the road, with a deadline to fix it.</p>
        </form>
      </Card>
      <Card id="ledger" className="lg:col-span-3" eyebrow="Accountability" title={t("ledgerTitle", lang)} right={<DemoBadge />}>
        <ul className="space-y-3">
          {list.slice(0, 6).map((h) => {
            const st = stageOf(h.status);
            const overdue = h.status === "Overdue";
            return (
              <li key={h.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-100">{h.type}</p>
                    <p className="text-sm text-slate-400">{h.place} · <span className="text-slate-300">{h.owner}</span></p>
                  </div>
                  {overdue ? <Badge kind="critical">Overdue {h.days - h.sla} days</Badge>
                    : st >= 4 ? <Badge kind="good">Fixed & confirmed</Badge>
                    : <Badge kind={st === 0 ? "info" : "warning"}>{h.status}</Badge>}
                </div>
                <ol className="mt-3 flex gap-1" aria-label="Progress">
                  {PIPE.map((p, i) => (
                    <li key={p} className="flex-1">
                      <div className={`h-1.5 rounded-full ${i <= st ? (overdue && i === st ? "bg-rose-500" : "bg-emerald-500") : "bg-slate-800"}`} />
                      <span className={`mt-1 hidden text-[10px] sm:block ${i <= st ? "text-slate-300" : "text-slate-600"}`}>{p}</span>
                    </li>
                  ))}
                </ol>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
