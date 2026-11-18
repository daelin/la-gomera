// Builds data/pois.json and data/plan.json
// Inputs: raw/pois.json (Overpass), sources/food-research.de.json, sources/wildcamp.json,
//         sources/water-extra.json, sources/plan.json, data/routes.geojson, data/protected.geojson
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pipMod from '@turf/boolean-point-in-polygon';
import { dist, nearestOnProfile } from './geo.mjs';

const pip = pipMod.default || pipMod;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (p) => JSON.parse(await fs.readFile(path.join(root, p), 'utf8'));

const routes = await read('data/routes.geojson');
const protectedAreas = (await read('data/protected.geojson')).features;
const osm = (await read('raw/pois.json')).elements;
const food = await read('sources/food-research.de.json');
const wild = await read('sources/wildcamp.json');
const waterExtra = await read('sources/water-extra.json');
const plan = await read('sources/plan.json');

// --- route profiles (GR132 as one continuous loop) ---
const profiles = {};
{
  let off = 0;
  profiles.GR132 = [];
  for (const f of routes.features.filter((f) => f.properties.route === 'GR132').sort((a, b) => a.properties.stage - b.properties.stage)) {
    for (const p of f.properties.profile) profiles.GR132.push([p[0] + off, p[1], p[2], p[3]]);
    off += f.properties.distance_m;
  }
  profiles.GR131 = routes.features.find((f) => f.properties.route === 'GR131').properties.profile;
  profiles['GR132-ALT'] = routes.features.find((f) => f.properties.route === 'GR132-ALT').properties.profile;
}
const pointAtKm = (route, km) => {
  const prof = profiles[route];
  let best = prof[0];
  for (const p of prof) if (Math.abs(p[0] - km * 1000) < Math.abs(best[0] - km * 1000)) best = p;
  return { lat: best[3], lon: best[2] };
};
function routePos(lat, lon) {
  const r = {};
  for (const [name, prof] of Object.entries(profiles)) {
    const n = nearestOnProfile(prof, [lon, lat]);
    if (n.off <= 6000) r[name] = [+(n.d / 1000).toFixed(2), Math.round(n.off), n.ele];
  }
  return r;
}
const minOff = (r) => Math.min(...Object.values(r).map((v) => v[1]), Infinity);
function protectedAt(lat, lon) {
  return protectedAreas.filter((f) => pip([lon, lat], f)).map((f) => f.properties.name);
}

// --- helpers ---
const DAYS = { Mo: 'Mo', Tu: 'Di', We: 'Mi', Th: 'Do', Fr: 'Fr', Sa: 'Sa', Su: 'So', PH: 'Feiertag' };
const ohToGerman = (oh) => oh
  .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (m) => DAYS[m])
  .replace(/\boff\b|\bclosed\b/g, 'geschlossen')
  .replace(/24\/7/, 'durchgehend (24/7)')
  .split(/\s*;\s*/).join('\n');
const latlon = (e) => [e.lat ?? e.center?.lat, e.lon ?? e.center?.lon];
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(supermercado|restaurante|bar|cafeteria|cafe|super|panaderia|dulceria|the|la|el|los|las|de|del)\b/g, '').replace(/\s+/g, ' ').trim();
const nameSim = (a, b) => {
  const A = new Set(norm(a).split(' ').filter(Boolean)), B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
};

// --- classify OSM ---
function classify(t) {
  const a = t.amenity, s = t.shop;
  const broken = t.drinking_water === 'no' || t['disused:amenity'] || /no funciona|not working|kaputt/i.test((t.name || '') + (t.operator || '') + (t.description || ''));
  if (a === 'drinking_water' || t.man_made === 'water_tap' || t.natural === 'spring' || a === 'water_point' ||
      (t.drinking_water === 'yes' && !t.tourism?.match(/camp_site/)) || t['disused:amenity'] === 'drinking_water') {
    if (a === 'fountain' && t.drinking_water !== 'yes' && t.natural !== 'spring') return null;
    return { cat: 'water', broken };
  }
  if (a === 'fountain') return null;
  if (s && /^(supermarket|convenience|general|bakery|greengrocer|butcher|deli|kiosk|farm|pastry)$/.test(s)) return { cat: 'supermarket' };
  if (a && /^(cafe|fast_food|bar|pub|ice_cream)$/.test(a)) return { cat: 'snack' };
  if (a === 'restaurant') return { cat: 'restaurant' };
  if (t.tourism === 'camp_site') return { cat: 'camp_official' };
  if (a && /^(pharmacy|atm|ferry_terminal|bus_station|fuel)$/.test(a)) return { cat: 'service' };
  if (s && /^(outdoor|sports)$/.test(s)) return { cat: 'service' };
  if (t.highway === 'bus_stop') return { cat: 'bus' };
  return null;
}
const MAX_OFF = { water: 1500, supermarket: 3000, snack: 1500, restaurant: 1500, service: 2500, bus: 600, camp_official: 8000 };
const SUBTYPE = {
  drinking_water: 'Trinkwasserstelle', water_tap: 'Wasserhahn', spring: 'Quelle', water_point: 'Wasserentnahmestelle',
  supermarket: 'Supermarkt', convenience: 'Lebensmittelladen / Tienda', general: 'Gemischtwarenladen', bakery: 'Bäckerei',
  greengrocer: 'Obst & Gemüse', butcher: 'Metzgerei', deli: 'Feinkost', kiosk: 'Kiosk', farm: 'Hofladen', pastry: 'Konditorei',
  cafe: 'Café', fast_food: 'Imbiss', bar: 'Bar', pub: 'Kneipe', ice_cream: 'Eisdiele', restaurant: 'Restaurant',
  pharmacy: 'Apotheke', atm: 'Geldautomat', ferry_terminal: 'Fährterminal', bus_station: 'Busbahnhof', fuel: 'Tankstelle (oft Snacks/Wasser)',
  outdoor: 'Outdoor-Laden', sports: 'Sportgeschäft', bus_stop: 'Bushaltestelle (Guagua)', camp_site: 'Campingplatz', picnic_site: 'Picknickplatz',
};

function waterReliability(t, broken) {
  if (broken) return { level: 'defekt', text: 'Laut OSM außer Betrieb oder KEIN Trinkwasser. Nicht einplanen!' };
  const checked = t.check_date ? ` (zuletzt geprüft ${t.check_date})` : '';
  if (t.natural === 'spring') {
    if (t.drinking_water === 'yes') return { level: 'mittel', text: `Quelle, als Trinkwasser markiert${checked}. Schüttung schwankt, im Zweifel filtern.` };
    return { level: 'niedrig', text: 'Natürliche Quelle, Qualität und Schüttung unbekannt. Nur gefiltert bzw. aufbereitet trinken.' };
  }
  if (t.amenity === 'water_point') return { level: 'niedrig', text: `Wasserentnahmestelle, Qualität unbekannt${t.description ? ` (${t.description})` : ''}. Filtern.` };
  if (t.amenity === 'drinking_water' || t.drinking_water === 'yes') {
    return { level: t.check_date ? 'hoch' : 'mittel', text: `Öffentliche Trinkwasserstelle laut OSM${checked}. Leitungswasser auf La Gomera ist gechlort. Nicht von Wanderern bestätigt, Funktion vor Ort prüfen.` };
  }
  return { level: 'niedrig', text: 'Wasserhahn, Trinkwasserqualität unbekannt (z. B. Bewässerung/Friedhof). Filtern oder aufbereiten.' };
}

function osmDesc(t) {
  const parts = [];
  if (t.description) parts.push(t.description);
  if (t.cuisine) parts.push('Küche: ' + t.cuisine.replace(/;/g, ', ').replace(/_/g, ' '));
  if (t['addr:street']) parts.push(`Adresse: ${t['addr:street']} ${t['addr:housenumber'] || ''}`.trim());
  if (t.phone || t['contact:phone']) parts.push('Tel.: ' + (t.phone || t['contact:phone']));
  if (t.website || t['contact:website']) parts.push('Web: ' + (t.website || t['contact:website']));
  if (t.check_date) parts.push('OSM geprüft: ' + t.check_date);
  return parts.join('\n');
}

const pois = [];
const byId = new Map();
function add(p) {
  const r = routePos(p.lat, p.lon);
  if (!Object.keys(r).length && !p.keep) return null;
  p.r = r;
  const pa = protectedAt(p.lat, p.lon);
  if (pa.length) p.protected = pa;
  if (pa.some((n) => /Parque Nacional/.test(n))) p.np = true;
  delete p.keep;
  pois.push(p);
  byId.set(p.id, p);
  return p;
}

// OSM POIs
for (const e of osm) {
  const t = e.tags || {};
  const c = classify(t);
  if (!c) continue;
  const [lat, lon] = latlon(e);
  if (lat == null) continue;
  const r = routePos(lat, lon);
  if (!Object.keys(r).length || minOff(r) > MAX_OFF[c.cat]) continue;
  const sub = t.amenity === 'drinking_water' ? 'drinking_water' : (t.man_made === 'water_tap' ? 'water_tap' : t.natural === 'spring' ? 'spring' : t.amenity || t.shop || t.highway || t.tourism);
  if (c.cat === 'camp_official') continue; // handled by curated list
  const p = {
    id: `osm-${e.type[0]}${e.id}`, cat: c.cat, sub: SUBTYPE[sub] || sub, name: t.name || SUBTYPE[sub] || 'Wasserstelle',
    lat: +lat.toFixed(6), lon: +lon.toFixed(6), src: 'osm',
    sources: [`https://www.openstreetmap.org/${e.type}/${e.id}`],
  };
  if (c.cat === 'water') {
    const rel = waterReliability(t, c.broken);
    p.reliability = rel.level;
    p.desc = rel.text + (t.description && !rel.text.includes(t.description) ? `\n${t.description}` : '');
    if (/not working|no funciona/i.test(p.name)) p.name = 'Trinkwasserstelle (defekt)';
  } else {
    p.desc = osmDesc(t);
  }
  if (t.opening_hours) { p.oh = t.opening_hours; p.hours = ohToGerman(t.opening_hours); p.hours_conf = 'B – OSM-Eintrag (Datum unbekannt)'; }
  if (c.cat === 'bus') p.desc = 'Guagua-Haltestelle, Notausstieg oder Abkürzung. Fahrpläne: guaguagomera.com (sonntags eingeschränkt).';
  if (t.amenity === 'fuel') p.desc = (p.desc ? p.desc + '\n' : '') + 'Tankstellen-Shops haben oft Wasser, Snacks und manchmal Gaskartuschen.';
  if (t.shop === 'outdoor' || t.shop === 'sports') p.desc = (p.desc ? p.desc + '\n' : '') + 'Mögliche Bezugsquelle für Gaskartuschen (nicht bestätigt, vorher fragen).';
  add(p);
}

// research food / shops: merge into OSM entries or add new ones
const CAT_MAP = { supermarket: 'supermarket', snack: 'snack', restaurant: 'restaurant', hardware: 'service', outdoor: 'service' };
let merged = 0, added = 0;
for (const f of food) {
  const cat = CAT_MAP[f.category];
  if (!cat || f.lat == null) continue;
  let best = null;
  for (const p of pois) {
    if (p.src !== 'osm' || !['supermarket', 'snack', 'restaurant', 'service'].includes(p.cat)) continue;
    const d = dist([p.lon, p.lat], [f.lon, f.lat]);
    if (d > 150) continue;
    const sim = nameSim(p.name, f.name);
    const score = sim * 2 + (d < 15 ? 1 : 0) + (p.cat === cat ? 0.5 : 0);
    if ((sim >= 0.5 || d < 15) && (!best || score > best.score)) best = { p, score };
  }
  const researchFields = {
    hours: f.opening_hours && f.opening_hours !== 'k. A.' ? f.opening_hours : undefined,
    hours_conf: f.confidence,
    note: f.notes,
    village: f.village,
  };
  if (best) {
    const p = best.p;
    if (researchFields.hours) p.hours = researchFields.hours;
    if (f.osm_opening_hours) p.oh = f.osm_opening_hours;
    p.hours_conf = researchFields.hours_conf;
    p.note = researchFields.note;
    p.village = researchFields.village;
    p.sources = [...new Set([...p.sources, ...(f.sources || [])])];
    p.researched = true;
    merged++;
  } else {
    const p = add({
      id: 'res-' + norm(f.name).replace(/ /g, '-').slice(0, 40) + '-' + Math.round(f.lat * 1e4 + f.lon * 1e4),
      cat, sub: f.category === 'hardware' ? 'Ferretería (Eisenwaren)' : f.category === 'outdoor' ? 'Outdoor-Laden' : SUBTYPE[f.category] || '',
      name: f.name, lat: f.lat, lon: f.lon, src: 'research',
      oh: f.osm_opening_hours || undefined, ...researchFields, sources: f.sources || [], researched: true,
      coord_confidence: f.coord_confidence,
    });
    if (p) added++;
  }
}

// curated extra water points from hiking reports
for (const w of waterExtra) {
  const pos = w.snap ? pointAtKm(w.snap.route, w.snap.km) : { lat: w.lat, lon: w.lon };
  add({ ...w, ...pos, snap: undefined, cat: 'water', src: 'research', keep: true });
}

// wildcamp spots + official camping
for (const s of wild.spots) {
  const pos = s.snap ? pointAtKm(s.snap.route, s.snap.km) : { lat: s.lat, lon: s.lon };
  add({
    id: s.id, cat: 'wildcamp', name: s.name, lat: pos.lat, lon: pos.lon, src: 'research', coord_confidence: s.coord_confidence,
    route_hint: s.route, between: s.between, rating: s.rating, notes_text: s.notes,
    details: { ground: s.ground, wind: s.wind, privacy: s.privacy, water: s.water, protected_area: s.protected_area },
    sources: s.sources, unverified: s.unverified, keep: true,
  });
}
for (const o of wild.official) {
  add({
    id: o.id, cat: 'camp_official', name: o.name, lat: o.lat, lon: o.lon, src: 'research', status: o.status,
    hours: o.hours, coord_confidence: o.coord_confidence,
    details: { cost: o.cost, permit: o.permit, facilities: o.facilities },
    notes_text: o.notes, sources: o.sources, keep: true,
  });
}

// --- plan with stats ---
function segStats(route, a, b) {
  const seg = profiles[route].filter((p) => p[0] >= a * 1000 && p[0] <= b * 1000);
  let up = 0, down = 0, ref = seg[0][1];
  for (const p of seg) {
    const d = p[1] - ref;
    if (Math.abs(d) >= 10) { if (d > 0) up += d; else down -= d; ref = p[1]; }
  }
  return { distance_km: +(b - a).toFixed(1), ascent_m: up, descent_m: down, max_ele: Math.max(...seg.map((p) => p[1])), end_ele: seg.at(-1)[1] };
}
const planOut = { ...plan, days: plan.days.map((d) => ({ ...d, ...segStats(d.route, d.from_km, d.to_km) })) };

const counts = pois.reduce((acc, p) => ((acc[p.cat] = (acc[p.cat] || 0) + 1), acc), {});
await fs.writeFile(path.join(root, 'data/pois.json'), JSON.stringify({
  generated: new Date().toISOString(),
  attribution: 'POIs © OpenStreetMap contributors (ODbL), ergänzt um Recherche aus Wanderberichten (Quellen je Eintrag)',
  legal: wild.legal,
  pois: pois.map((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== ''))),
}));
await fs.writeFile(path.join(root, 'data/plan.json'), JSON.stringify(planOut));
console.log('POIs:', counts, '| research merged:', merged, 'added:', added);
console.table(planOut.days.map((d) => ({ day: d.day, route: d.route, km: d.distance_km, up: d.ascent_m, down: d.descent_m, max: d.max_ele, camp: d.camp })));
const missing = plan.days.flatMap((d) => [d.camp, ...d.alt_camps]).filter((id) => id && !byId.has(id));
if (missing.length) { console.error('Plan references unknown camp ids:', missing); process.exit(1); }
for (const p of pois.filter((p) => p.cat === 'wildcamp')) {
  console.log(p.id.padEnd(30), Object.entries(p.r).map(([k, v]) => `${k} km ${v[0]} off ${v[1]}m`).join(' | '), p.np ? 'NATIONALPARK!' : '', (p.protected || []).join(', '));
}
