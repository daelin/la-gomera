// Builds data/routes.geojson from raw/routes.json (Overpass "out geom" of GR 131 / GR 132 relations).
// - stitches relation member ways into ordered lines
// - orients GR 132 stages counter-clockwise (official stage order) and GR 131 Vallehermoso -> San Sebastián
// - samples elevation (Copernicus DEM via Open-Meteo) and computes distance / ascent / descent
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dist } from './geo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(await fs.readFile(path.join(root, 'raw/routes.json'), 'utf8'));
const elevCachePath = path.join(root, 'raw/elevation-cache.json');
let elevCache = {};
try { elevCache = JSON.parse(await fs.readFile(elevCachePath, 'utf8')); } catch {}

function stitch(rel) {
  const ways = rel.members.filter((m) => m.type === 'way' && m.role !== 'excursion' && m.geometry)
    .map((m) => m.geometry.map((p) => [p.lon, p.lat]));
  const used = new Array(ways.length).fill(false);
  const pick = (end) => {
    let best = null;
    for (let i = 0; i < ways.length; i++) {
      if (used[i]) continue;
      const w = ways[i];
      const d0 = dist(end, w[0]), d1 = dist(end, w[w.length - 1]);
      const d = Math.min(d0, d1);
      if (!best || d < best.d - 1e-6) best = { i, d, rev: d1 < d0 };
    }
    return best;
  };
  // orient the first way so that its end touches the second way
  let first = ways[0];
  if (ways[1]) {
    const n = ways[1];
    const dEnd = Math.min(dist(first.at(-1), n[0]), dist(first.at(-1), n.at(-1)));
    const dStart = Math.min(dist(first[0], n[0]), dist(first[0], n.at(-1)));
    if (dStart < dEnd) first = [...first].reverse();
  }
  used[0] = true;
  const segments = [];
  let cur = [...first];
  for (;;) {
    const b = pick(cur.at(-1));
    if (!b) break;
    used[b.i] = true;
    const w = b.rev ? [...ways[b.i]].reverse() : ways[b.i];
    if (b.d > 60) {
      segments.push(cur);
      cur = [...w];
    } else {
      cur.push(...w.slice(1));
    }
  }
  segments.push(cur);
  return segments;
}

function mergeSegments(segs) {
  const out = [...segs[0]];
  const gaps = [];
  for (let i = 1; i < segs.length; i++) {
    const s = segs[i];
    const e = out.at(-1);
    const d0 = dist(e, s[0]), d1 = dist(e, s.at(-1));
    const ss = d1 < d0 ? [...s].reverse() : s;
    gaps.push({ at: e, meters: Math.round(Math.min(d0, d1)) });
    out.push(...ss);
  }
  return { line: out, gaps };
}

// samples a point every `step` meters along the line; returns [[lon, lat], ...] and along-path distances
function resample(line, step) {
  const pts = [line[0]];
  const along = [0];
  let acc = 0, total = 0;
  for (let i = 1; i < line.length; i++) {
    let a = line[i - 1];
    const b = line[i];
    let d = dist(a, b);
    while (acc + d >= step) {
      const t = (step - acc) / d;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      total += step;
      pts.push(p);
      along.push(total);
      d = dist(p, b);
      a = p;
      acc = 0;
    }
    acc += d;
  }
  total += acc;
  pts.push(line.at(-1));
  along.push(total);
  return { pts, along };
}

async function elevations(pts) {
  const res = new Array(pts.length);
  const k = (p) => p[0].toFixed(5) + ',' + p[1].toFixed(5);
  const missing = [];
  pts.forEach((p, i) => (elevCache[k(p)] != null ? (res[i] = elevCache[k(p)]) : missing.push(i)));
  for (let s = 0; s < missing.length; s += 100) {
    const chunk = missing.slice(s, s + 100);
    const lat = chunk.map((i) => pts[i][1].toFixed(5)).join(',');
    const lon = chunk.map((i) => pts[i][0].toFixed(5)).join(',');
    let json;
    for (let attempt = 0; attempt < 8 && !json; attempt++) {
      const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
      if (r.ok) json = await r.json();
      else {
        console.error('elevation API', r.status, (await r.text()).slice(0, 200), '→ retry');
        await new Promise((ok) => setTimeout(ok, 15000 * (attempt + 1)));
      }
    }
    if (!json) throw new Error('elevation API failed');
    chunk.forEach((i, j) => { res[i] = json.elevation[j]; elevCache[k(pts[i])] = json.elevation[j]; });
    await fs.writeFile(elevCachePath, JSON.stringify(elevCache));
    await new Promise((ok) => setTimeout(ok, 1500));
  }
  return res;
}

const smooth = (arr, w = 2) => arr.map((_, i) => {
  let s = 0, n = 0;
  for (let j = Math.max(0, i - w); j <= Math.min(arr.length - 1, i + w); j++) { s += arr[j]; n++; }
  return s / n;
});

async function profile(line) {
  const { pts, along } = resample(line, 50);
  const ele = smooth(await elevations(pts));
  let up = 0, down = 0, d = 0, ref = ele[0];
  const prof = [[0, Math.round(ele[0]), +pts[0][0].toFixed(5), +pts[0][1].toFixed(5)]];
  for (let i = 1; i < pts.length; i++) {
    // along-path distance (chords between samples would cut corners on switchbacks)
    d = along[i];
    // hysteresis keeps DEM noise from inflating the totals
    const diff = ele[i] - ref;
    if (Math.abs(diff) >= 10) { if (diff > 0) up += diff; else down -= diff; ref = ele[i]; }
    prof.push([Math.round(d), Math.round(ele[i]), +pts[i][0].toFixed(5), +pts[i][1].toFixed(5)]);
  }
  return {
    distance_m: Math.round(d), ascent_m: Math.round(up), descent_m: Math.round(down),
    min_ele: Math.round(Math.min(...ele)), max_ele: Math.round(Math.max(...ele)),
    // [distance from start (m), elevation (m), lon, lat] every ~50 m
    profile: prof,
  };
}

const round6 = (line) => line.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]);
const rels = raw.elements;
const features = [];
const report = [];
const SAN_SEBASTIAN = [-17.1110, 28.0910];

const stageNo = (r) => +(r.tags.name || '').match(/Etapa (\d)/)?.[1];
const stageRels = rels.filter((r) => r.tags.ref === 'GR 132' && stageNo(r)).sort((a, b) => stageNo(a) - stageNo(b));
let prevEnd = null;
for (const r of stageRels) {
  const n = stageNo(r);
  let { line, gaps } = mergeSegments(stitch(r));
  const anchor = prevEnd || SAN_SEBASTIAN;
  if (dist(anchor, line.at(-1)) < dist(anchor, line[0])) line = [...line].reverse();
  prevEnd = line.at(-1);
  const p = await profile(line);
  report.push({ name: r.tags.name, gaps, ...p });
  features.push({
    type: 'Feature',
    properties: { route: 'GR132', stage: n, osm_relation: r.id, name: `GR 132 Etappe ${n}: ${r.tags.from} → ${r.tags.to}`, from: r.tags.from, to: r.tags.to, ...p },
    geometry: { type: 'LineString', coordinates: round6(line) },
  });
}

const alt = rels.find((r) => r.tags.ref === 'GR 132' && /Alternativa/.test(r.tags.name || ''));
if (alt) {
  const segs = stitch(alt).filter((s) => s.length > 1);
  for (const [i, s] of segs.entries()) {
    const p = await profile(s);
    report.push({ name: 'GR 132 Alternativa ' + (i + 1), gaps: [], ...p });
    features.push({
      type: 'Feature',
      properties: { route: 'GR132-ALT', osm_relation: alt.id, name: 'GR 132 Variante (Alternativa)', ...p },
      geometry: { type: 'LineString', coordinates: round6(s) },
    });
  }
}

const gr131 = rels.find((r) => r.tags.ref === 'GR 131');
{
  let { line, gaps } = mergeSegments(stitch(gr131));
  // OSM relation runs San Sebastián -> Vallehermoso; the app shows Vallehermoso -> San Sebastián
  if (dist(SAN_SEBASTIAN, line[0]) < dist(SAN_SEBASTIAN, line.at(-1))) line = [...line].reverse();
  const p = await profile(line);
  report.push({ name: 'GR 131', gaps, ...p });
  features.push({
    type: 'Feature',
    properties: { route: 'GR131', osm_relation: gr131.id, name: 'GR 131: Vallehermoso → San Sebastián', from: 'Vallehermoso', to: 'San Sebastián', via: gr131.tags.via, ...p },
    geometry: { type: 'LineString', coordinates: round6(line) },
  });
  const exc = gr131.members.find((m) => m.role === 'excursion');
  if (exc) {
    features.push({
      type: 'Feature',
      properties: { route: 'GR131-EXC', name: 'GR 131 Abstecher Alto de Garajonay (1487 m)' },
      geometry: { type: 'LineString', coordinates: exc.geometry.map((g) => [g.lon, g.lat]) },
    });
  }
}

await fs.writeFile(path.join(root, 'data/routes.geojson'), JSON.stringify({
  type: 'FeatureCollection',
  attribution: '© OpenStreetMap contributors (ODbL); Höhen: Copernicus DEM GLO-90 via Open-Meteo',
  generated: new Date().toISOString(),
  features,
}));
await fs.writeFile(elevCachePath, JSON.stringify(elevCache));
console.table(report.map((r) => ({
  name: r.name, km: (r.distance_m / 1000).toFixed(1), up: r.ascent_m, down: r.descent_m, max: r.max_ele,
  start: r.profile[0].slice(2).join(','), end: r.profile.at(-1).slice(2).join(','),
  gaps: r.gaps.map((g) => g.meters + 'm').join(' '),
})));
