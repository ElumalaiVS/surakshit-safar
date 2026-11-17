import React, { useEffect, useMemo, useState } from "react";
import { Card, Badge, DemoBadge, Segmented, Source, useCopy } from "./ui.jsx";
import { GroupedBars, DataTable, Ring, pct } from "./charts.jsx";
import {
  PLACES, ROADS, HOTSPOTS, PILOT_SERIES, KPI_BY_PERIOD, CHITTOOR_YOY, CASES, CASE_STAGES,
  GOLDEN_FUNNEL, AGENCIES, HAZARDS, REAL_STATS, initialIncidents, makeIncident, rnd,
} from "./data.js";

// ============================================================ KPI banner
export function KpiBanner({ incidents }) {
  const [period, setPeriod] = useState("monthly");
  const active = incidents.filter((i) => i.dispatch.tow !== "done").length;
  const k = KPI_BY_PERIOD[period];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi label="Active incidents" live
        value={<span className="tabular">{active}</span>}
        foot={<span className="text-slate-400">{incidents.filter((i) => i.severity === "Critical" && i.dispatch.tow !== "done").length} critical · Nagari pilot area</span>} />
      <Kpi label="Avg. ambulance arrival"
        value={<span className="tabular">17.6<span className="ml-1 text-lg text-slate-400">min</span></span>}
        foot={<span className="text-amber-300">Crash to trauma care: 117 min, past the golden hour</span>} />
      <Kpi label="New accidents recorded"
        value={<span className="tabular">{k.value}</span>}
        right={<Segmented size="sm" label="Period" value={period} onChange={setPeriod}
          options={[{ id: "fortnightly", label: "15d" }, { id: "monthly", label: "Month" }, { id: "yearly", label: "Year" }]} />}
        foot={<Delta v={k.delta} goodWhenDown suffix="vs previous period" />} />
      <Kpi label="Safety index"
        value={<span className="tabular">72<span className="ml-1 text-lg text-slate-400">/100</span></span>}
        foot={<Delta v={6} suffix="vs last month" />} />
    </div>
  );
}

function Kpi({ label, value, foot, right, live }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-2 text-sm text-slate-400">
          {live && <span className="relative flex h-2 w-2" aria-hidden="true"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-60 motion-reduce:animate-none" /><span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" /></span>}
          {label}
        </p>
        {right}
      </div>
      <p className="mt-2 font-display text-3xl font-bold text-slate-50">{value}</p>
      <p className="mt-1 text-xs">{foot}</p>
    </div>
  );
}

function Delta({ v, goodWhenDown, suffix }) {
  const good = goodWhenDown ? v < 0 : v > 0;
  return <span className={good ? "text-emerald-300" : "text-rose-300"}>{v > 0 ? "▲" : "▼"} {Math.abs(v)}% <span className="text-slate-400">{suffix}</span></span>;
}

// ============================================================ live incidents hook
export function useIncidents() {
  const [list, setList] = useState(initialIncidents);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const add = setInterval(() => {
      setList((l) => {
        const advanced = l.map((i) => {
          const d = { ...i.dispatch };
          for (const k of ["ambulance", "police", "tow"]) {
            if (d[k] === "waiting" && rnd() < 0.35) { d[k] = "active"; break; }
            if (d[k] === "active" && rnd() < 0.3) { d[k] = "done"; break; }
          }
          return { ...i, dispatch: d };
        });
        const fresh = rnd() < 0.45 ? [makeIncident(2420 + Math.floor(rnd() * 900), 0)] : [];
        return [...fresh, ...advanced].slice(0, 9);
      });
    }, 12000);
    return () => { clearInterval(tick); clearInterval(add); };
  }, []);
  return [list, now];
}

// ============================================================ Phase 1: before
export function PhaseBefore() {
  const [sel, setSel] = useState(HOTSPOTS[0].id);
  const h = HOTSPOTS.find((x) => x.id === sel);
  const P = (id) => PLACES[id];
  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <Card className="xl:col-span-3" eyebrow="Phase 1 · Predictive intelligence" title="Risk hotspots around Nagari" right={<DemoBadge />}>
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#0b1220]">
          <svg viewBox="0 0 420 400" className="h-auto w-full" role="img" aria-label="Schematic map of roads and risk hotspots around Nagari">
            <defs>
              <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#16213a" strokeWidth="1" /></pattern>
              <radialGradient id="heat"><stop offset="0" stopColor="#f43f5e" stopOpacity=".55" /><stop offset="1" stopColor="#f43f5e" stopOpacity="0" /></radialGradient>
            </defs>
            <rect width="420" height="400" fill="url(#grid)" />
            <path d="M330 300 C 360 320, 390 330, 420 335" stroke="#334155" strokeDasharray="4 4" fill="none" />
            <text x="372" y="320" className="fill-slate-500 text-[9px]">TN</text>
            <text x="352" y="300" className="fill-slate-500 text-[9px]">AP</text>
            {ROADS.map((r) => {
              const pts = r.pts.map((id) => P(id));
              const off = r.offset || 0;
              const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y + off}`).join(" ");
              const style = r.kind === "nh" ? { stroke: "#94a3b8", w: 4 } : r.kind === "sh" ? { stroke: "#64748b", w: 2.5 } : { stroke: "#a78bfa", w: 2 };
              return <path key={r.id} d={d} fill="none" stroke={style.stroke} strokeWidth={style.w} strokeLinecap="round" strokeDasharray={r.kind === "build" ? "6 5" : ""} />;
            })}
            {HOTSPOTS.map((s) => (
              <g key={s.id} onClick={() => setSel(s.id)} className="cursor-pointer" role="button" tabIndex="0" aria-label={`${s.name}, risk ${s.risk}`}
                 onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSel(s.id)}>
                <circle cx={s.x} cy={s.y} r={14 + s.risk / 4} fill="url(#heat)" />
                <circle cx={s.x} cy={s.y} r={sel === s.id ? 8 : 6} fill={s.risk >= 70 ? "#f43f5e" : "#f59e0b"} stroke="#0b1220" strokeWidth="2" />
                {sel === s.id && <circle cx={s.x} cy={s.y} r="12" fill="none" stroke="#f8fafc" strokeWidth="1.5" />}
              </g>
            ))}
            {Object.values(PLACES).map((p) => (
              <g key={p.name}>
                <circle cx={p.x} cy={p.y} r={p.name === "Nagari" ? 5 : 3.5} fill="#e2e8f0" />
                <text x={p.x + 8} y={p.y - 6} className={`fill-slate-200 ${p.name === "Nagari" ? "text-[13px] font-semibold" : "text-[10px]"}`}>{p.name}</text>
              </g>
            ))}
            <text x="222" y="86" className="fill-slate-400 text-[10px]" transform="rotate(56 222 86)">NH 716</text>
          </svg>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5"><span className="h-1 w-5 rounded bg-slate-400" />National highway</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 rounded bg-slate-500" />District road</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 border-t-2 border-dashed border-violet-400" />NH 716B (under construction)</span>
          <span>Schematic, not to scale</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <div>
            <p className="font-medium text-slate-100">{h.name}</p>
            <p className="text-sm text-slate-400">{h.why}</p>
          </div>
          <Badge kind={h.risk >= 70 ? "critical" : "warning"}>Risk {h.risk}/100</Badge>
        </div>
      </Card>

      <div className="space-y-6 xl:col-span-2">
        <Card eyebrow="High-risk corridor alerts" title="Next 6 hours" right={<DemoBadge />}>
          <ul className="space-y-2">
            {[
              ["critical", "NH 716 Puttur–Nagari", "Night + rain: rear-end risk with parked lorries. Ask highway patrol to clear shoulders by 8 pm."],
              ["warning", "NH 716 near AP–TN border", "Wrong-side two-wheelers peak 6–9 pm. Suggest a police point at the median gap."],
              ["warning", "Nagari–Karvetinagaram Rd", "Crater reported by 12 phones; R&B notified, unlit stretch after dusk."],
            ].map(([sev, where, what]) => (
              <li key={where} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                <div className="flex items-center justify-between gap-2"><p className="font-medium text-slate-100">{where}</p><Badge kind={sev}>{sev === "critical" ? "High" : "Elevated"}</Badge></div>
                <p className="mt-1 text-sm text-slate-400">{what}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card eyebrow="Predictive risk factors" title="Conditions right now" right={<DemoBadge />}>
          <div className="grid grid-cols-2 gap-4">
            <Ring value={68} tone="amber" label="Weather impact (NE monsoon rain)" />
            <Ring value={54} tone="amber" label="Traffic congestion index" />
            <Ring value={81} tone="rose" label="Night-time exposure" />
            <Ring value={47} tone="sky" label="Pilgrim traffic to Tirumala" />
          </div>
          <p className="mt-4 text-xs text-slate-500">In the pilot these come from IMD weather, traffic counts and the SafeGuard app's speed and hard-braking data.</p>
        </Card>
      </div>
    </div>
  );
}

// ============================================================ Phase 2: during
const DISPATCH = [["ambulance", "Ambulance 108"], ["police", "Police"], ["tow", "Tow / clearance"]];

export function PhaseDuring({ incidents, now }) {
  const [sel, setSel] = useState(null);
  const current = incidents.find((i) => i.id === sel) || incidents[0];
  const mins = current ? Math.floor((now - current.at) / 60000) : 0;
  const secs = current ? Math.floor(((now - current.at) % 60000) / 1000) : 0;
  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <Card className="xl:col-span-3" eyebrow="Phase 2 · Active incident response" title="Live incident stream" right={<DemoBadge />}>
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="px-2 py-2 font-medium">Incident</th>
                <th className="px-2 py-2 font-medium">Severity</th>
                <th className="px-2 py-2 font-medium">Time</th>
                <th className="px-2 py-2 font-medium">Location (GPS)</th>
                <th className="px-2 py-2 font-medium">Dispatch</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((i) => {
                const active = current && i.id === current.id;
                return (
                  <tr key={i.id} onClick={() => setSel(i.id)} tabIndex="0" onKeyDown={(e) => e.key === "Enter" && setSel(i.id)}
                      className={`cursor-pointer border-t border-slate-800 transition-colors focus-ring ${active ? "bg-slate-800/60" : "hover:bg-slate-800/30"}`}>
                    <td className="px-2 py-2.5">
                      <span className="relative block pl-3">
                        <span className={`absolute left-0 top-0.5 h-full w-1 rounded-full ${i.severity === "Critical" ? "bg-rose-500" : i.severity === "Serious" ? "bg-amber-400" : "bg-slate-500"}`} />
                        <span className="font-mono text-xs text-slate-400">{i.id}</span>
                        <span className="block text-slate-100">{i.type}</span>
                      </span>
                    </td>
                    <td className="px-2 py-2.5"><Badge kind={i.severity}>{i.severity}</Badge></td>
                    <td className="px-2 py-2.5 tabular text-slate-300">{new Date(i.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-2 py-2.5">
                      <span className="block text-slate-200">{i.place}</span>
                      <span className="font-mono text-xs text-slate-500">{i.lat}, {i.lon}</span>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="flex gap-1" aria-label="Dispatch status">
                        {DISPATCH.map(([k, name]) => <Dot key={k} state={i.dispatch[k]} title={`${name}: ${i.dispatch[k]}`} />)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">New incidents arrive from 112 / 108 calls and SafeGuard crash alerts. Click a row to track it.</p>
      </Card>

      {current && (
        <div className="space-y-6 xl:col-span-2">
          <Card eyebrow="Dispatch tracker" title={current.id} right={<Badge kind={current.severity}>{current.severity}</Badge>}>
            <p className="text-sm text-slate-300">{current.type} · {current.place}</p>
            <ol className="mt-4 space-y-3">
              {DISPATCH.map(([k, name]) => {
                const s = current.dispatch[k];
                return (
                  <li key={k} className="flex items-center gap-3">
                    <Dot state={s} big />
                    <span className="flex-1 text-slate-100">{name}</span>
                    <span className={`text-sm ${s === "done" ? "text-emerald-300" : s === "active" ? "text-amber-300" : "text-slate-500"}`}>
                      {s === "done" ? (k === "tow" ? "Road cleared" : "On scene") : s === "active" ? "En route" : "Waiting"}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Card>
          <Card eyebrow="Golden hour" title="Time since crash">
            <GoldenClock mins={mins} secs={secs} severe={current.severity !== "Minor"} />
          </Card>
        </div>
      )}
    </div>
  );
}

function Dot({ state, big, title }) {
  const c = state === "done" ? "bg-emerald-500" : state === "active" ? "bg-amber-400" : "bg-slate-700";
  return <span title={title} className={`inline-block rounded-full ${c} ${big ? "h-3 w-3" : "h-2.5 w-2.5"} ${state === "active" ? "motion-safe:animate-pulse" : ""}`} />;
}

function GoldenClock({ mins, secs, severe }) {
  const frac = Math.min(1, mins / 60);
  const over = mins >= 60;
  return (
    <div>
      <p className={`font-display text-4xl font-bold tabular ${over ? "text-rose-300" : mins >= 40 ? "text-amber-300" : "text-slate-50"}`}>
        {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
        <div className={`h-full rounded-full ${over ? "bg-rose-500" : mins >= 40 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${frac * 100}%` }} />
      </div>
      <p className="mt-2 text-sm text-slate-400">
        {over ? "Past the golden hour." : `${60 - mins} min left in the golden hour.`}
        {severe && " Serious injuries need definitive care in Tirupati; there is no highway trauma centre in the district."}
      </p>
    </div>
  );
}

// ============================================================ Phase 3: after
export function PhaseAfter() {
  const [period, setPeriod] = useState("monthly");
  const [asTable, setAsTable] = useState(false);
  const yearly = {
    labels: CHITTOOR_YOY.map((r) => r.label),
    prev: CHITTOOR_YOY.map((r) => r.prev),
    cur: CHITTOOR_YOY.map((r) => r.cur),
    note: "Chittoor district, January–October: 2024 vs 2023",
  };
  const s = period === "yearly" ? yearly : PILOT_SERIES[period];
  const names = period === "yearly" ? ["Jan–Oct 2023", "Jan–Oct 2024"] : period === "monthly" ? ["2025", "2026"] : ["Last year", "This year"];
  const total = GOLDEN_FUNNEL.reduce((a, b) => a + b.min, 0);
  let acc = 0;
  return (
    <div className="space-y-6">
      <Card eyebrow="Phase 3 · Reporting engine" title="Accidents: this period vs the same period before"
        right={<div className="flex flex-wrap items-center gap-2">
          <Segmented size="sm" label="Period" value={period} onChange={setPeriod}
            options={[{ id: "fortnightly", label: "Fortnightly" }, { id: "monthly", label: "Monthly" }, { id: "yearly", label: "Yearly" }]} />
          <button type="button" onClick={() => setAsTable(!asTable)} className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 focus-ring">{asTable ? "Show chart" : "Show table"}</button>
        </div>}>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-slate-400">
          <span>{s.note}</span>
          {period === "yearly" ? <Source id="chittoor2024" /> : <DemoBadge />}
        </div>
        {asTable ? <DataTable labels={s.labels} prev={s.prev} cur={s.cur} prevName={names[0]} curName={names[1]} />
          : <GroupedBars labels={s.labels} prev={s.prev} cur={s.cur} prevName={names[0]} curName={names[1]} />}
        {period === "yearly" && (
          <p className="mt-3 text-sm text-slate-300">Deaths in Chittoor district rose <b className="text-rose-300">{pct(290, 326)}</b> in the first ten months of 2024. These are real state figures; the fortnightly and monthly views use pilot demo data.</p>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card eyebrow="Golden-hour funnel" title="Where the minutes go (median, serious cases)" right={<DemoBadge />}>
          <div className="relative mt-2">
            <div className="flex h-9 overflow-hidden rounded-lg">
              {GOLDEN_FUNNEL.map((f, i) => {
                const w = (f.min / total) * 100;
                const shades = ["bg-slate-500", "bg-slate-400", "bg-sky-600", "bg-sky-500", "bg-rose-500"];
                return <div key={f.step} className={`${shades[i]} border-r-2 border-slate-900 last:border-r-0`} style={{ width: `${w}%` }} title={`${f.step}: ${f.min} min`} />;
              })}
            </div>
            <div className="absolute -top-2 bottom-0 w-0.5 bg-amber-300" style={{ left: `${(60 / total) * 100}%` }} aria-hidden="true" />
            <p className="absolute -top-6 text-xs font-semibold text-amber-300" style={{ left: `calc(${(60 / total) * 100}% - 2.2rem)` }}>60 min</p>
          </div>
          <ol className="mt-4 space-y-1.5 text-sm">
            {GOLDEN_FUNNEL.map((f) => {
              acc += f.min;
              return (
                <li key={f.step} className="flex justify-between gap-3">
                  <span className="text-slate-300">{f.step}</span>
                  <span className={`tabular ${acc > 60 ? "text-rose-300" : "text-slate-200"}`}>{f.min} min <span className="text-slate-500">({acc})</span></span>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-sm text-slate-300">The biggest loss is the transfer to Tirupati. A trauma centre at Nagari Area Hospital, proposed but pending, would remove most of it. <Source id="trauma" /></p>
        </Card>

        <Card eyebrow="Case closure" title="Insurance & investigation tracking" right={<DemoBadge />}>
          <ul className="space-y-4">
            {CASES.map((c) => (
              <li key={c.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm text-slate-300">{c.id}</span>
                  <span className="text-xs text-slate-400">Day {c.days} · Insurer: <span className="text-slate-200">{c.insurer}</span> · {c.investigation}</span>
                </div>
                <ol className="mt-2 flex gap-1">
                  {CASE_STAGES.map((st, i) => (
                    <li key={st} className="flex-1" title={st}>
                      <div className={`h-1.5 rounded-full ${i < c.stage ? "bg-emerald-500" : i === c.stage ? "bg-amber-400" : "bg-slate-800"}`} />
                    </li>
                  ))}
                </ol>
                {c.days > 120 && !c.mact && <p className="mt-1 text-xs text-rose-300">Claim not filed and the 6-month deadline is close.</p>}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
            {CASE_STAGES.map((s, i) => <span key={s}>{i + 1}. {s}</span>)}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================ Official: accountability
export function Accountability() {
  const [copied, copy] = useCopy();
  const brief = useMemo(() => {
    const overdue = HAZARDS.filter((h) => h.status === "Overdue");
    return [
      "SafeGrid weekly road-safety brief: Nagari pilot area",
      `Open hazards: ${HAZARDS.filter((h) => !["Closed"].includes(h.status)).length}; overdue: ${overdue.length}`,
      ...overdue.map((h) => `- OVERDUE ${h.days - h.sla}d: ${h.type}, ${h.place} (${h.owner})`),
      "Context: Chittoor district recorded 326 road deaths in Jan–Oct 2024 (AP SCRB).",
    ].join("\n");
  }, []);
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {REAL_STATS.map((s) => (
          <div key={s.k} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-card">
            <p className="text-sm text-slate-400">{s.k}</p>
            <p className="mt-1 font-display text-3xl font-bold tabular text-slate-50">{s.v}</p>
            <p className="text-xs text-slate-400">{s.note}</p>
            <div className="mt-2"><Source id={s.src} /></div>
          </div>
        ))}
      </div>

      <Card eyebrow="Fix or explain" title="Agency scorecard"
        right={<div className="flex items-center gap-2"><DemoBadge />
          <button type="button" onClick={() => copy(brief)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-white focus-ring">Copy gram sabha brief</button></div>}>
        {copied === true && <p className="mb-2 text-xs text-emerald-300" role="status">Brief copied.</p>}
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="px-2 py-2 font-medium">Agency</th>
                <th className="px-2 py-2 text-right font-medium">Open</th>
                <th className="px-2 py-2 text-right font-medium">Overdue</th>
                <th className="px-2 py-2 text-right font-medium">Median days to fix</th>
                <th className="px-2 py-2 text-right font-medium">Fixes that failed</th>
              </tr>
            </thead>
            <tbody>
              {AGENCIES.map((a) => (
                <tr key={a.name} className="border-t border-slate-800 tabular">
                  <td className="px-2 py-2.5 text-slate-100">{a.name}</td>
                  <td className="px-2 py-2.5 text-right text-slate-200">{a.open}</td>
                  <td className="px-2 py-2.5 text-right">{a.overdue ? <Badge kind="critical">{a.overdue}</Badge> : <Badge kind="good">0</Badge>}</td>
                  <td className="px-2 py-2.5 text-right text-slate-200">{a.median}</td>
                  <td className="px-2 py-2.5 text-right">{a.reopened ? <span className="text-amber-300">{a.reopened}</span> : <span className="text-slate-500">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">"Fixes that failed": the agency marked a hazard fixed, but riders or phone sensors kept reporting it, so it reopened automatically.</p>
      </Card>

      <Card eyebrow="Hazard tickets" title="SLA clock per hazard" right={<DemoBadge />}>
        <ul className="divide-y divide-slate-800">
          {HAZARDS.map((h) => {
            const frac = Math.min(1, h.days / h.sla);
            const overdue = h.status === "Overdue";
            return (
              <li key={h.id} className="grid gap-2 py-3 sm:grid-cols-12 sm:items-center">
                <div className="sm:col-span-5">
                  <p className="text-slate-100"><span className="mr-2 font-mono text-xs text-slate-500">{h.id}</span>{h.type}</p>
                  <p className="text-xs text-slate-400">{h.place} · {h.tier}</p>
                </div>
                <p className="text-sm text-slate-300 sm:col-span-3">{h.owner}</p>
                <div className="sm:col-span-2">
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-800"><div className={`h-full ${overdue ? "bg-rose-500" : frac > 0.7 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${frac * 100}%` }} /></div>
                  <p className="mt-1 text-[11px] tabular text-slate-500">Day {h.days} of {h.sla}</p>
                </div>
                <div className="sm:col-span-2 sm:text-right">
                  <Badge kind={overdue ? "critical" : h.status === "Closed" ? "good" : "warning"}>{h.status}</Badge>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
