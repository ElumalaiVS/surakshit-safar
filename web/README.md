# SafeGrid Analytics (web dashboard)

The platform behind the SafeGuard rider app: accident management, hazard accountability and family support for the Nagari pilot, Chittoor district, Andhra Pradesh.

**Open it now:** download `dist/index.html` and open it in any browser. It is one self-contained file and works offline (fonts load from Google Fonts when online).

## Three views

| View | For | What it has |
|---|---|---|
| **Citizens & families** (`#citizen`) | Anyone at a crash site, and bereaved or injured families | One-tap 112 / 108 / 1033, where to take the injured, Good Samaritan rights, SOS message, first aid; **family case companion** (PM RAHAT 7-day and MACT 6-month deadlines, document checklist saved on the device, compensation estimate with legal-aid advice, Know Your Rights, helplines); route safety check; hazard reporting and "who is fixing what". English, Telugu, Tamil. |
| **Control room** (`#responder`) | 108 / police / district control room | KPI banner (live active incidents, response time, accidents by fortnight / month / year, safety index); **Before**: hotspot map, corridor alerts, risk factors; **During**: live incident stream with severity, time and GPS, dispatch tracker, golden-hour clock; **After**: period comparison charts, golden-hour funnel, insurance and investigation tracking. |
| **Officials** (`#official`) | Collector, NHAI PIU, municipality, panchayats | Real district figures with sources, agency scorecard, SLA clock per hazard, copyable weekly gram sabha brief. |

## Data honesty

- Figures with a **Source** link are real published numbers (MoRTH, AP SCRB, PIB, Lok Sabha answers).
- Panels marked **Pilot demo** use simulated data until the pilot is live. All demo data lives in `src/data.js`; replace it with API calls to the PostGIS backend in `../db`.
- The compensation estimate (`src/estimator.js`) follows the Sarla Verma multipliers and Pranay Sethi heads. It is an indication only; the page tells families to consult free legal aid (15100) before accepting any settlement.

## Build from source

```bash
cd web
npm install
npm run build        # writes dist/index.html (React + Tailwind inlined)
```

| File | Purpose |
|---|---|
| `src/App.jsx` | Header, view switch (hash routing), language switch |
| `src/citizen.jsx` | Emergency panel, family companion, estimator, rights, route check, hazard desk |
| `src/control.jsx` | KPI banner, live incident simulation, Before / During / After phases, accountability |
| `src/charts.jsx` | Grouped bar chart with tooltip and table view, ring gauges |
| `src/ui.jsx` | Card, badges, segmented control, collapsible cards, copy helper |
| `src/data.js` | Sources, real statistics, Nagari map schematic, demo data |
| `src/i18n.js` | Telugu and Tamil strings for the citizen view |
| `src/estimator.js` | Death-claim compensation estimate |
