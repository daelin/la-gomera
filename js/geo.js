const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// haversine distance in meters between [lon, lat] points
export function dist(a, b) {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function bearing(a, b) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// profile samples: [d (m), ele, lon, lat]; returns { i, d, ele, off }
export function nearest(profile, p) {
  let best = null;
  for (let i = 0; i < profile.length; i++) {
    const s = profile[i];
    // cheap equirectangular pre-check
    const dx = (s[2] - p[0]) * 98000, dy = (s[3] - p[1]) * 111000;
    const q = dx * dx + dy * dy;
    if (!best || q < best.q) best = { i, q };
  }
  const s = profile[best.i];
  return { i: best.i, d: s[0], ele: s[1], off: dist([s[2], s[3]], p) };
}

// ascent/descent between two distances (m) along a profile
export function climb(profile, fromD, toD) {
  let up = 0, down = 0, ref = null;
  for (const s of profile) {
    if (s[0] < fromD || s[0] > toD) continue;
    if (ref == null) { ref = s[1]; continue; }
    const d = s[1] - ref;
    if (Math.abs(d) >= 10) { if (d > 0) up += d; else down -= d; ref = s[1]; }
  }
  return { up: Math.round(up), down: Math.round(down) };
}

// DIN 33466 hiking time in minutes (optional factor, e.g. for a heavy pack)
export function hikeMinutes(km, up, down, factor = 1.0) {
  const h = km / 4, v = up / 300 + down / 500;
  return Math.round((Math.max(h, v) + Math.min(h, v) / 2) * 60 * factor);
}

export const fmtKm = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',')} km`);
export const fmtDur = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`);

// point-in-polygon for GeoJSON (Multi)Polygon
function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function inGeometry(p, g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.some((poly) => inRing(p, poly[0]) && !poly.slice(1).some((h) => inRing(p, h)));
}

// slippy-map tile math
export const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
export const lat2y = (lat, z) => Math.floor(((1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2) * 2 ** z);
export function tilesInBBox(z, [s, w, n, e]) {
  const out = [];
  for (let x = lon2x(w, z); x <= lon2x(e, z); x++) for (let y = lat2y(n, z); y <= lat2y(s, z); y++) out.push([z, x, y]);
  return out;
}
export function tilesAlong(z, points, bufferM) {
  const set = new Set();
  const dLat = bufferM / 111000;
  for (const [lon, lat] of points) {
    const dLon = bufferM / (111000 * Math.cos(rad(lat)));
    for (let x = lon2x(lon - dLon, z); x <= lon2x(lon + dLon, z); x++)
      for (let y = lat2y(lat + dLat, z); y <= lat2y(lat - dLat, z); y++) set.add(`${z}/${x}/${y}`);
  }
  return [...set].map((k) => k.split('/').map(Number));
}

// sunrise / sunset (NOAA approximation), returns Date objects (UTC instants)
export function sunTimes(date, lat, lon) {
  const d0 = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const n = Math.floor((d0 - Date.UTC(2000, 0, 1, 12)) / 86400000) + 1;
  const Jstar = n - lon / 360;
  const M = (357.5291 + 0.98560028 * Jstar) % 360;
  const C = 1.9148 * Math.sin(rad(M)) + 0.02 * Math.sin(rad(2 * M)) + 0.0003 * Math.sin(rad(3 * M));
  const L = (M + C + 180 + 102.9372) % 360;
  const Jtransit = 2451545 + Jstar + 0.0053 * Math.sin(rad(M)) - 0.0069 * Math.sin(rad(2 * L));
  const decl = Math.asin(Math.sin(rad(L)) * Math.sin(rad(23.44)));
  const cosW = (Math.sin(rad(-0.833)) - Math.sin(rad(lat)) * Math.sin(decl)) / (Math.cos(rad(lat)) * Math.cos(decl));
  const w = deg(Math.acos(Math.max(-1, Math.min(1, cosW))));
  const toDate = (J) => new Date((J - 2440587.5) * 86400000);
  return { rise: toDate(Jtransit - w / 360), set: toDate(Jtransit + w / 360) };
}
