import React, { useEffect, useState } from "react";
import { Segmented } from "./ui.jsx";
import { LANGS } from "./i18n.js";
import { Emergency, Services, FamilyCompanion, RouteCheck, HazardDesk } from "./citizen.jsx";
import { KpiBanner, useIncidents, PhaseBefore, PhaseDuring, PhaseAfter, Accountability } from "./control.jsx";

const ROLES = [
  { id: "citizen", label: "Citizens & families" },
  { id: "responder", label: "Control room" },
  { id: "official", label: "Officials" },
];
const PHASES = [
  { id: "before", label: "Before · Prevent" },
  { id: "during", label: "During · Respond" },
  { id: "after", label: "After · Recover" },
];

function readHash() {
  const h = (window.location.hash || "").replace("#", "");
  return ROLES.some((r) => r.id === h) ? h : "citizen";
}

function Logo() {
  return (
    <svg viewBox="0 0 40 40" className="h-9 w-9 flex-none" aria-hidden="true">
      <path d="M20 3 34 8v11c0 9-6 15.5-14 18C12 34.5 6 28 6 19V8z" fill="#065f46" stroke="#34d399" strokeWidth="1.6" />
      <path d="M13 14h14M13 20h14M13 26h14M17 10v20M23 10v20" stroke="#6ee7b7" strokeOpacity=".45" strokeWidth="1" />
      <path d="m14 20 4 4 8-9" fill="none" stroke="#ecfdf5" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function App() {
  const [role, setRole] = useState(readHash);
  const [phase, setPhase] = useState("during");
  const [lang, setLang] = useState(() => { try { return localStorage.getItem("sg-lang") || "en"; } catch { return "en"; } });
  const [incidents, now] = useIncidents();

  useEffect(() => {
    const on = () => setRole(readHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => { try { localStorage.setItem("sg-lang", lang); } catch { /* ignore */ } }, [lang]);

  const go = (r) => { setRole(r); history.replaceState(null, "", `#${r}`); window.scrollTo({ top: 0 }); };

  return (
    <div className={`min-h-screen ${lang !== "en" && role === "citizen" ? `lang-${lang}` : ""}`}>
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo />
            <div>
              <p className="font-display text-lg font-bold leading-tight text-slate-50">SafeGrid Analytics</p>
              <p className="text-xs text-slate-400">Accident management & public safety · Pilot: Nagari, Chittoor district, AP</p>
            </div>
          </div>
          <nav aria-label="Views" className="flex flex-wrap items-center gap-2">
            <Segmented label="Choose a view" value={role} onChange={go} options={ROLES} size="sm" />
            {role === "citizen" && (
              <Segmented label="Language" value={lang} onChange={setLang} size="sm" options={LANGS.map((l) => ({ id: l.id, label: l.label }))} />
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-2.5 text-xs text-slate-400">
          <span className="font-semibold text-slate-300">How to read this page:</span>
          <span>Figures with a <span className="text-sky-300">Source</span> link are real published numbers.</span>
          <span>Panels marked <span className="rounded-full border border-slate-600 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">Pilot demo</span> show simulated data until the Nagari pilot goes live.</span>
        </p>

        {role === "citizen" && (
          <>
            <Emergency lang={lang} />
            <Services lang={lang} />
            <FamilyCompanion lang={lang} />
            <RouteCheck lang={lang} />
            <HazardDesk lang={lang} />
            <p className="pt-2 text-center text-xs text-slate-500">
              Built in memory of the seven lives lost on our village road. SafeGuard is the rider app; SafeGrid Analytics is the platform behind it.
            </p>
          </>
        )}

        {role === "responder" && (
          <>
            <KpiBanner incidents={incidents} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="font-display text-xl font-semibold text-slate-50">Incident lifecycle</h1>
              <Segmented label="Phase" value={phase} onChange={setPhase} options={PHASES} />
            </div>
            {phase === "before" && <PhaseBefore />}
            {phase === "during" && <PhaseDuring incidents={incidents} now={now} />}
            {phase === "after" && <PhaseAfter />}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-900/50 bg-emerald-950/20 p-4">
              <p className="text-sm text-slate-200">Every closed incident hands the family a case companion: deadlines, documents, compensation and free legal aid, in Telugu, Tamil or English.</p>
              <button type="button" onClick={() => go("citizen")} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 focus-ring">Open family support</button>
            </div>
          </>
        )}

        {role === "official" && (
          <>
            <KpiBanner incidents={incidents} />
            <Accountability />
          </>
        )}
      </main>
    </div>
  );
}
