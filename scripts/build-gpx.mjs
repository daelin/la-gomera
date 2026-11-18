// Builds one GPX file per plan day (track with elevation + all POIs along the way as waypoints)
// plus a combined tour file. Output: gpx/*.gpx and gpx/manifest.json (used by the app + service worker).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dist } from './geo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (p) => JSON.parse(await fs.readFile(path.join(root, p), 'utf8'));
const routes = await read('data/routes.geojson');
const { pois } = await read('data/pois.json');
const plan = await read('data/plan.json');

// full-resolution geometry per route with cumulative distance: [lon, lat, d]
function withDist(coords, offset = 0) {
  let d = offset;
  return coords.map((c, i) => {
    if (i) d += dist(coords[i - 1], c);
    return [c[0], c[1], d];
  });
}
const geom = {}, profile = {};
{
  const g131 = routes.features.find((f) => f.properties.route === 'GR131');
  geom.GR131 = withDist(g131.geometry.coordinates);
  profile.GR131 = g131.properties.profile;
  geom.GR132 = [];
  profile.GR132 = [];
  let off = 0;
  for (const f of routes.features.filter((f) => f.properties.route === 'GR132').sort((a, b) => a.properties.stage - b.properties.stage)) {
    const g = withDist(f.geometry.coordinates, off);
    geom.GR132.push(...(geom.GR132.length ? g.slice(1) : g));
    profile.GR132.push(...f.properties.profile.map((p) => [p[0] + off, ...p.slice(1)]));
    off += f.properties.distance_m;
  }
}

function eleAt(route, d) {
  const P = profile[route];
  let lo = 0, hi = P.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m][0] <= d) lo = m; else hi = m; }
  const a = P[lo], b = P[hi];
  const t = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (d - a[0]) / (b[0] - a[0])));
  return Math.round(a[1] + (b[1] - a[1]) * t);
}

function slice(route, fromKm, toKm) {
  const G = geom[route], a = fromKm * 1000, b = toKm * 1000;
  const interp = (p, q, d) => { const t = (d - p[2]) / (q[2] - p[2] || 1); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, d]; };
  const out = [];
  for (let i = 1; i < G.length; i++) {
    const p = G[i - 1], q = G[i];
    if (q[2] < a || p[2] > b) continue;
    if (!out.length) out.push(p[2] < a ? interp(p, q, a) : p);
    if (q[2] <= b) out.push(q);
    else { out.push(interp(p, q, b)); break; }
  }
  return out.map(([lon, lat, d]) => ({ lon, lat, ele: eleAt(route, d), d }));
}

const NEAR = { water: 500, supermarket: 1500, snack: 700, restaurant: 700, wildcamp: 1500, camp_official: 5000, service: 1000 };
const LABEL = { wildcamp: 'Camp', camp_official: 'Camping offiziell', water: 'Wasser', supermarket: 'Laden', snack: 'Café/Imbiss', restaurant: 'Restaurant', service: 'Service' };
const SYM = { wildcamp: 'Campground', camp_official: 'Campground', water: 'Drinking Water', supermarket: 'Shopping Center', snack: 'Bar', restaurant: 'Restaurant', service: 'Information' };
const REL = { hoch: 'zuverlässig', mittel: 'wahrscheinlich ok', niedrig: 'unsicher – filtern', defekt: 'DEFEKT / kein Trinkwasser' };

const esc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const kmStr = (km) => km.toFixed(1).replace('.', ',');
const dateOf = (n) => { const d = new Date(plan.start_date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n - 1); return d; };
const fmtDate = (d) => d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });

function wptDesc(p, km, off, campDay, altOf) {
  const L = [];
  if (campDay) L.push(`>>> GEPLANTES NACHTLAGER TAG ${campDay} <<<`);
  if (altOf) L.push(`Ausweich-Camp für Tag ${altOf}`);
  L.push(`km ${kmStr(km)} · ${off < 60 ? 'direkt am Weg' : `${off} m abseits`}`);
  if (p.unverified) L.push('KEINE Berichte – Planungsvorschlag, vor Ort prüfen');
  if (p.coord_confidence === 'low') L.push('Position ungefähr (Suchbereich)');
  if (p.reliability) L.push(`Wasser: ${REL[p.reliability]}`);
  if (p.hours) L.push(`Öffnungszeiten: ${p.hours.replace(/\n/g, '; ')}`);
  if (p.np) L.push('NATIONALPARK – Zelten verboten');
  else if (p.protected?.length) L.push(`Schutzgebiet: ${p.protected.join(', ')}`);
  const d = p.details || {};
  for (const [k, v] of [['Untergrund', d.ground], ['Wind', d.wind], ['Sichtschutz', d.privacy], ['Wasser', d.water], ['Kosten', d.cost], ['Anmeldung', d.permit]]) if (v) L.push(`${k}: ${v}`);
  if (p.notes_text) L.push(p.notes_text);
  if (p.desc) L.push(p.desc);
  if (p.note) L.push(p.note);
  return L.join('\n');
}

function waypointsFor(day) {
  const route = day.route;
  const out = [];
  for (const p of pois) {
    const r = p.r?.[route];
    if (!r || !NEAR[p.cat]) continue;
    const isCamp = day.camp === p.id, isAlt = day.alt_camps.includes(p.id);
    if (!isCamp && !isAlt && (r[1] > NEAR[p.cat] || r[0] < day.from_km - 0.2 || r[0] > day.to_km + 0.2)) continue;
    if (p.cat === 'service' && !/Apotheke|Geldautomat|Ferretería|Outdoor|Sport/.test(p.sub || '')) continue;
    const prefix = isCamp ? `Camp T${day.day}` : p.reliability === 'defekt' ? 'Wasser DEFEKT' : LABEL[p.cat];
    out.push({
      lat: p.lat, lon: p.lon, km: r[0], ele: r[2],
      name: `${prefix}: ${p.name}`.slice(0, 90),
      desc: wptDesc(p, r[0], r[1], isCamp ? day.day : null, isAlt ? day.day : null),
      sym: SYM[p.cat], type: LABEL[p.cat], id: p.id,
    });
  }
  return out.sort((a, b) => a.km - b.km);
}

const wptXml = (w) => `  <wpt lat="${w.lat.toFixed(6)}" lon="${w.lon.toFixed(6)}">${w.ele != null ? `<ele>${w.ele}</ele>` : ''}<name>${esc(w.name)}</name><desc>${esc(w.desc)}</desc><sym>${w.sym}</sym><type>${esc(w.type)}</type></wpt>`;
const trkXml = (name, desc, pts) => `  <trk><name>${esc(name)}</name><desc>${esc(desc)}</desc><type>hiking</type><trkseg>\n${pts.map((p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><ele>${p.ele}</ele></trkpt>`).join('\n')}\n    </trkseg></trk>`;
const gpxDoc = (name, desc, body) => `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Gomera Trek" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata><name>${esc(name)}</name><desc>${esc(desc)}</desc><author><name>Gomera Trek</name></author><copyright author="OpenStreetMap contributors"><license>https://opendatacommons.org/licenses/odbl/</license></copyright></metadata>
${body}
</gpx>
`;
const ascii = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

const outDir = path.join(root, 'gpx');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
const manifest = [];
const allWpts = new Map();
const allTrks = [];
for (const day of plan.days) {
  const pts = slice(day.route, day.from_km, day.to_km);
  const parts = day.title.split('→').map((s) => s.trim());
  const file = `GomeraTrek_Tag${day.day}_${ascii(parts[0])}-${ascii(parts.at(-1))}.gpx`;
  const name = `Gomera Trek Tag ${day.day} (${fmtDate(dateOf(day.day))}): ${day.title}`;
  const desc = `${day.route.replace('GR', 'GR ')} km ${kmStr(day.from_km)}–${kmStr(day.to_km)} · ${kmStr(day.distance_km)} km · ↑${day.ascent_m} m ↓${day.descent_m} m\n${day.summary}\nEssen: ${day.food}\nWasser: ${day.water}${day.warnings ? `\nAchtung: ${day.warnings}` : ''}`;
  const wpts = waypointsFor(day);
  wpts.unshift({ lat: pts[0].lat, lon: pts[0].lon, ele: pts[0].ele, km: day.from_km, name: `Start Tag ${day.day}`, desc: day.title, sym: 'Flag, Green', type: 'Start' });
  if (!day.camp) wpts.push({ lat: pts.at(-1).lat, lon: pts.at(-1).lon, ele: pts.at(-1).ele, km: day.to_km, name: `Ziel Tag ${day.day}: ${day.night || ''}`.trim(), desc: day.night || '', sym: 'Flag, Red', type: 'Ziel' });
  const trk = trkXml(`Tag ${day.day}: ${day.title}`, desc, pts);
  await fs.writeFile(path.join(outDir, file), gpxDoc(name, desc, `${wpts.map(wptXml).join('\n')}\n${trk}`));
  manifest.push({ day: day.day, file: `gpx/${file}`, points: pts.length, waypoints: wpts.length });
  allTrks.push(trk);
  for (const w of wpts) if (w.id && (!allWpts.has(w.id) || w.name.startsWith('Camp T'))) allWpts.set(w.id, w);
}
const tourFile = 'GomeraTrek_Gesamttour_GR131-GR132.gpx';
await fs.writeFile(path.join(outDir, tourFile), gpxDoc(plan.title, `${plan.days.length} Tagesetappen als einzelne Tracks + alle POIs am Weg`, `${[...allWpts.values()].map(wptXml).join('\n')}\n${allTrks.join('\n')}`));
manifest.push({ day: 0, file: `gpx/${tourFile}`, waypoints: allWpts.size });
await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.table(manifest);
