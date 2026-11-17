import React, { useState } from "react";

// Validated categorical pair on the slate-900 surface (dataviz validator: all checks pass).
export const SERIES = { prev: "#7b6ef2", cur: "#1e9c8b" };

/** Grouped bars: previous vs current period. Hover/focus a group for exact values. */
export function GroupedBars({ labels, prev, cur, prevName, curName, height = 220 }) {
  const [hover, setHover] = useState(null);
  const W = 640, H = height, padL = 36, padR = 8, padT = 12, padB = 30;
  const max = Math.max(...prev, ...cur);
  const nice = Math.ceil(max / 5) * 5 || 5;
  const ticks = [0, nice / 2, nice].map((v) => Math.round(v));
  const gw = (W - padL - padR) / labels.length;
  const bw = Math.min(26, gw / 3.2);
  const y = (v) => padT + (H - padT - padB) * (1 - v / nice);
  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-300">
        <Legend color={SERIES.prev} label={prevName} />
        <Legend color={SERIES.cur} label={curName} />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
           aria-label={`${curName} versus ${prevName}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#334155" strokeWidth="1" strokeDasharray={t ? "2 4" : ""} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="fill-slate-400 text-[11px] tabular">{t}</text>
          </g>
        ))}
        {labels.map((l, i) => {
          const gx = padL + i * gw + gw / 2;
          const active = hover === i;
          return (
            <g key={l} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
               onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex="0" className="outline-none">
              <rect x={gx - gw / 2} y={padT} width={gw} height={H - padT - padB} fill={active ? "#1e293b" : "transparent"} rx="6" />
              <Bar x={gx - bw - 1} w={bw} y0={y(0)} y1={y(prev[i])} color={SERIES.prev} />
              <Bar x={gx + 1} w={bw} y0={y(0)} y1={y(cur[i])} color={SERIES.cur} />
              <text x={gx} y={H - 10} textAnchor="middle" className="fill-slate-400 text-[11px]">{l}</text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute right-2 top-8 rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs shadow-lg">
          <p className="mb-1 font-semibold text-slate-100">{labels[hover]}</p>
          <p className="tabular text-slate-300"><Swatch c={SERIES.prev} /> {prevName}: <b className="text-slate-100">{prev[hover]}</b></p>
          <p className="tabular text-slate-300"><Swatch c={SERIES.cur} /> {curName}: <b className="text-slate-100">{cur[hover]}</b></p>
          <p className="mt-1 tabular text-slate-400">Change: {pct(prev[hover], cur[hover])}</p>
        </div>
      )}
    </div>
  );
}

function Bar({ x, w, y0, y1, color }) {
  const h = Math.max(0, y0 - y1);
  const r = Math.min(4, h / 2);
  // rounded data-end only, anchored flat on the baseline
  const d = `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`;
  return <path d={d} fill={color} />;
}

const Swatch = ({ c }) => <span className="inline-block h-2 w-2 rounded-sm align-middle" style={{ background: c }} />;
function Legend({ color, label }) {
  return <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{label}</span>;
}
export function pct(a, b) {
  if (!a) return "–";
  const p = Math.round(((b - a) / a) * 100);
  return `${p > 0 ? "+" : ""}${p}%`;
}

/** Plain table view of the same data (accessibility + exact numbers). */
export function DataTable({ labels, prev, cur, prevName, curName }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular">
        <thead>
          <tr className="text-left text-slate-400">
            <th className="py-2 pr-4 font-medium">Period</th>
            <th className="py-2 pr-4 font-medium text-right">{prevName}</th>
            <th className="py-2 pr-4 font-medium text-right">{curName}</th>
            <th className="py-2 font-medium text-right">Change</th>
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={l} className="border-t border-slate-800 text-slate-200">
              <td className="py-2 pr-4">{l}</td>
              <td className="py-2 pr-4 text-right">{prev[i]}</td>
              <td className="py-2 pr-4 text-right">{cur[i]}</td>
              <td className={`py-2 text-right ${cur[i] > prev[i] ? "text-rose-300" : "text-emerald-300"}`}>{pct(prev[i], cur[i])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Small ring gauge, 0..100. */
export function Ring({ value, label, tone = "amber" }) {
  const c = { amber: "#f59e0b", rose: "#f43f5e", emerald: "#10b981", sky: "#38bdf8" }[tone];
  const r = 26, C = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#1e293b" strokeWidth="7" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={c} strokeWidth="7" strokeLinecap="round"
                strokeDasharray={`${(value / 100) * C} ${C}`} transform="rotate(-90 32 32)" />
        <text x="32" y="37" textAnchor="middle" className="fill-slate-100 text-[15px] font-semibold tabular">{value}</text>
      </svg>
      <span className="text-sm text-slate-300">{label}</span>
    </div>
  );
}
