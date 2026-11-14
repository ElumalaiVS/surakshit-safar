// Geodesy helpers used on-device. Pure functions, no allocation-heavy deps,
// cheap enough for a 1 Hz alert loop on a budget Android phone.

export const EARTH_R = 6371008.8; // mean Earth radius, metres
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface LatLon { lat: number; lon: number; }

/** Great-circle distance in metres (haversine). Accurate to <0.5% at these ranges. */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * D2R;
  const dLon = (b.lon - a.lon) * D2R;
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b, degrees clockwise from north [0, 360). */
export function bearing(a: LatLon, b: LatLon): number {
  const p1 = a.lat * D2R, p2 = b.lat * D2R, dl = (b.lon - a.lon) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** Smallest absolute angle between two bearings, [0, 180]. */
export function bearingDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Signed relative bearing of target vs heading, (-180, 180]; negative = left. */
export function relativeBearing(heading: number, target: number): number {
  let d = (target - heading) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Point reached travelling `dist` metres from `p` on bearing `brg`. */
export function destination(p: LatLon, brg: number, dist: number): LatLon {
  const d = dist / EARTH_R, t = brg * D2R, p1 = p.lat * D2R, l1 = p.lon * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1),
                             Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * R2D, lon: ((l2 * R2D + 540) % 360) - 180 };
}

/** Bounding box (degrees) of a circle, for R*Tree prefilter. */
export function radiusToDegrees(lat: number, radiusM: number): { dLat: number; dLon: number } {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.max(0.01, Math.cos(lat * D2R)));
  return { dLat, dLon };
}

/**
 * Local equirectangular projection around an origin: metres east (x) / north (y).
 * Error is negligible (<0.1%) within a few km, which is all the alert loop needs.
 */
export function toLocal(origin: LatLon, p: LatLon): { x: number; y: number } {
  const x = (p.lon - origin.lon) * D2R * EARTH_R * Math.cos(origin.lat * D2R);
  const y = (p.lat - origin.lat) * D2R * EARTH_R;
  return { x, y };
}

/** Distance from point p to polyline (metres) + index/fraction of closest segment. */
export function distanceToPolyline(p: LatLon, line: LatLon[]):
    { distance: number; segIndex: number; t: number; alongM: number } {
  let best = { distance: Infinity, segIndex: 0, t: 0, alongM: 0 };
  let cum = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = toLocal(p, line[i]);
    const b = toLocal(p, line[i + 1]);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const segLen = Math.sqrt(len2);
    let t = len2 === 0 ? 0 : -(a.x * dx + a.y * dy) / len2;   // p is the origin (0,0)
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx, cy = a.y + t * dy;
    const d = Math.hypot(cx, cy);
    if (d < best.distance) best = { distance: d, segIndex: i, t, alongM: cum + t * segLen };
    cum += segLen;
  }
  return best;
}

const GH32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Standard geohash encoder (same cells as PostGIS ST_GeoHash). */
export function geohash(lat: number, lon: number, precision = 5): string {
  let latLo = -90, latHi = 90, lonLo = -180, lonHi = 180;
  let hash = '', bit = 0, ch = 0, evenBit = true;
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lonLo + lonHi) / 2;
      if (lon >= mid) { ch = (ch << 1) | 1; lonLo = mid; } else { ch <<= 1; lonHi = mid; }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; latLo = mid; } else { ch <<= 1; latHi = mid; }
    }
    evenBit = !evenBit;
    if (++bit === 5) { hash += GH32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

/** Geohash-5 tiles needed to cover a circle around a point (home-region prefetch). */
export function tilesAround(center: LatLon, radiusM: number, precision = 5): string[] {
  const out = new Set<string>();
  const step = Math.max(500, radiusM / 8);
  for (let dy = -radiusM; dy <= radiusM; dy += step) {
    for (let dx = -radiusM; dx <= radiusM; dx += step) {
      if (dx * dx + dy * dy > radiusM * radiusM) continue;
      const lat = center.lat + (dy / EARTH_R) * R2D;
      const lon = center.lon + (dx / (EARTH_R * Math.cos(center.lat * D2R))) * R2D;
      out.add(geohash(lat, lon, precision));
    }
  }
  return [...out].sort();
}
