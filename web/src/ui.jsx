import React, { useState } from "react";
import { SOURCES } from "./data.js";

export function Card({ title, eyebrow, right, children, className = "", tone = "default", id }) {
  const tones = {
    default: "border-slate-800 bg-slate-900/70",
    calm: "border-emerald-900/50 bg-slate-900/70",
    alert: "border-rose-900/60 bg-rose-950/20",
  };
  return (
    <section id={id} className={`rounded-2xl border ${tones[tone]} shadow-card p-5 sm:p-6 ${className}`}>
      {(title || right) && (
        <header className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 mb-1">{eyebrow}</p>}
            {title && <h2 className="font-display text-lg sm:text-xl font-semibold text-slate-50 text-balance">{title}</h2>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function DemoBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300" title="Simulated data until the pilot goes live">
      <svg width="8" height="8" aria-hidden="true"><circle cx="4" cy="4" r="3" fill="none" stroke="currentColor" strokeDasharray="2 1.5" /></svg>
      Pilot demo
    </span>
  );
}

export function Source({ id }) {
  const s = SOURCES[id];
  if (!s) return null;
  return (
    <a href={s.url} target="_blank" rel="noreferrer"
       className="inline-flex items-center gap-1 text-[11px] text-sky-300/90 hover:text-sky-200 underline decoration-sky-700 underline-offset-2">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1h6v6M9 1 4 6M1 3v6h6" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
      Source: {s.label}
    </a>
  );
}

const SEV = {
  Critical: "bg-rose-500/15 text-rose-300 ring-rose-500/40",
  Serious: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
  Minor: "bg-slate-500/15 text-slate-300 ring-slate-500/40",
  critical: "bg-rose-500/15 text-rose-300 ring-rose-500/40",
  warning: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
  info: "bg-sky-500/15 text-sky-300 ring-sky-500/40",
  good: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40",
};
const SEV_ICON = { Critical: "▲", critical: "▲", Serious: "◆", warning: "◆", Minor: "●", info: "●", good: "✓" };

export function Badge({ kind, children }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${SEV[kind] || SEV.info}`}>
      <span aria-hidden="true" className="text-[9px]">{SEV_ICON[kind] || "●"}</span>
      {children}
    </span>
  );
}

export function Segmented({ options, value, onChange, label, size = "md" }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-slate-950/70 p-1 ring-1 ring-slate-800">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button key={o.id} type="button" role="radio" aria-checked={active} onClick={() => onChange(o.id)}
            className={`rounded-lg font-medium transition-colors focus-ring ${size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm"} ${
              active ? "bg-slate-100 text-slate-900 shadow" : "text-slate-300 hover:text-white hover:bg-slate-800"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Collapsible card built on <details> so it works with keyboard and screen readers. */
export function Disclosure({ title, children, defaultOpen = false, accent = "emerald" }) {
  const accents = { emerald: "bg-emerald-400", amber: "bg-amber-400", sky: "bg-sky-400", rose: "bg-rose-400" };
  return (
    <details open={defaultOpen} className="group rounded-xl border border-slate-800 bg-slate-950/40 open:bg-slate-950/70 transition-colors">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 focus-ring rounded-xl">
        <span className={`h-6 w-1 rounded-full ${accents[accent]}`} aria-hidden="true" />
        <span className="flex-1 font-medium text-slate-100">{title}</span>
        <svg className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </summary>
      <div className="px-4 pb-4 pl-8 text-sm leading-relaxed text-slate-300 space-y-2">{children}</div>
    </details>
  );
}

export function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied("fail");
    }
  };
  return [copied, copy];
}

export const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
export const lakh = (n) => "₹" + (n / 100000).toLocaleString("en-IN", { maximumFractionDigits: 1 }) + " lakh";
