import { status as ohStatus, dayLabel } from './hours.js';
import * as G from './geo.js';

const TZ = 'Atlantic/Canary';
const ISLAND_BBOX = [27.99, -17.36, 28.23, -17.08]; // s, w, n, e
const TILE_CACHE = 'tiles-v1';
const TILE_SOURCES = {
  topo: {
    name: 'OpenTopoMap (Topo, offline speicherbar)',
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', maxNativeZoom: 17,
    attribution: 'Karte: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA), Daten © <a href="https://www.openstreetmap.org/copyright">OSM</a>',
  },
  osm: {
    name: 'OpenStreetMap Standard (nur online)',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxNativeZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
};

const CATS = {
  wildcamp: { label: 'Wildcamping', icon: '⛺', color: '#2e7d32', size: 32, on: true, minZoom: 0 },
  camp_official: { label: 'Offiziell', icon: '🏕️', color: '#b8860b', size: 34, on: true, minZoom: 0 },
  water: { label: 'Wasser', icon: '💧', color: '#0277bd', size: 26, on: true, minZoom: 0 },
  supermarket: { label: 'Läden', icon: '🛒', color: '#ef6c00', size: 26, on: true, minZoom: 11 },
  snack: { label: 'Imbiss/Café', icon: '☕', color: '#795548', size: 24, on: true, minZoom: 13 },
  restaurant: { label: 'Restaurants', icon: '🍽️', color: '#6a1b9a', size: 24, on: true, minZoom: 13 },
  service: { label: 'Sonstiges', icon: 'ℹ️', color: '#455a64', size: 22, on: false, minZoom: 12 },
  bus: { label: 'Bus', icon: '🚌', color: '#00897b', size: 20, on: false, minZoom: 13 },
  own: { label: 'Eigene', icon: '📌', color: '#d81b60', size: 26, on: true, minZoom: 0 },
};
const ROUTES = {
  GR132: { label: 'GR 132', color: '#d7263d', on: true },
  GR131: { label: 'GR 131', color: '#1b65d6', on: true },
  ALT: { label: 'Varianten', color: '#d7263d', on: true },
  protected: { label: 'Schutzgebiete', color: '#c62828', on: true },
};
// how far off-track a POI may be to count as "on the way" (m)
const NEAR = { water: 400, supermarket: 1500, snack: 700, restaurant: 700, wildcamp: 2500, camp_official: 8000, service: 1500, bus: 300, own: 2000 };

// ---------- state ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('gt-' + k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem('gt-' + k, JSON.stringify(v)); },
};
const state = {
  cats: { ...Object.fromEntries(Object.entries(CATS).map(([k, c]) => [k, c.on])), ...store.get('cats', {}) },
  routes: { ...Object.fromEntries(Object.entries(ROUTES).map(([k, c]) => [k, c.on])), ...store.get('routes', {}) },
  listCats: store.get('listCats', { wildcamp: true, camp_official: true, water: true, supermarket: true, snack: false, restaurant: false, service: false, bus: false, own: true }),
  tiles: store.get('tiles', 'topo'),
  startDate: store.get('startDate', null),
  own: store.get('own', []),
  me: store.get('lastPos', null), // {lat, lon, acc, t}
  follow: false,
  watching: false,
};

let D = {}; // data
const prof = {}; // route profiles [d, ele, lon, lat]
let map, tileLayer;
const catLayers = {};
const markers = new Map();
const routeLayers = {};
let arrowLayer, kmLayer, dayHiLayer, meMarker, meCircle;
let currentSheet = null;

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const canaryNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
const fmtTime = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const fmtDate = (d) => d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const kmStr = (km) => km.toFixed(1).replace('.', ',');

function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

// ---------- data ----------
async function loadData() {
  const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); });
  const [routes, pois, plan, prot] = await Promise.all([
    get('data/routes.geojson'), get('data/pois.json'), get('data/plan.json'), get('data/protected.geojson'),
  ]);
  D = { routes, pois: pois.pois, legal: pois.legal, poisMeta: pois, plan, prot };
  let off = 0;
  prof.GR132 = [];
  D.stages = [];
  for (const f of routes.features.filter((f) => f.properties.route === 'GR132').sort((a, b) => a.properties.stage - b.properties.stage)) {
    D.stages.push({ ...f.properties, start: off, end: off + f.properties.distance_m, profile: undefined });
    for (const p of f.properties.profile) prof.GR132.push([p[0] + off, p[1], p[2], p[3]]);
    off += f.properties.distance_m;
  }
  prof.GR131 = routes.features.find((f) => f.properties.route === 'GR131').properties.profile;
  prof.ALT = routes.features.find((f) => f.properties.route === 'GR132-ALT').properties.profile;
  // the planned tour: GR 131 (Vallehermoso → San Sebastián), then the GR 132 loop
  D.L131 = prof.GR131.at(-1)[0];
  prof.TOUR = [...prof.GR131, ...prof.GR132.slice(1).map((p) => [p[0] + D.L131, p[1], p[2], p[3]])];
  D.gpx = await get('gpx/manifest.json').catch(() => []);
  for (const o of state.own) o.r = routePos(o.lat, o.lon);
  D.planCamp = new Map(D.plan.days.filter((d) => d.camp).map((d) => [d.camp, d.day]));
}

function routePos(lat, lon) {
  const r = {};
  for (const [k, key] of [['GR132', 'GR132'], ['GR131', 'GR131'], ['ALT', 'GR132-ALT']]) {
    const n = G.nearest(prof[k], [lon, lat]);
    if (n.off <= 6000) r[key] = [+(n.d / 1000).toFixed(2), Math.round(n.off), n.ele];
  }
  return r;
}
const allPois = () => [...D.pois, ...state.own];
const startDate = () => new Date((state.startDate || D.plan.start_date) + 'T12:00:00');
const dayDate = (n) => { const d = startDate(); d.setDate(d.getDate() + n - 1); return d; };
const protectedAt = (lat, lon) => D.prot.features.filter((f) => G.inGeometry([lon, lat], f.geometry)).map((f) => f.properties);

// ---------- map ----------
function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true, minZoom: 9, maxZoom: 18, tap: true })
    .setView([28.115, -17.235], window.innerWidth < 500 ? 11 : 12);
  L.control.zoom({ position: 'topleft' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  setTiles(state.tiles);
  map.createPane('protected'); map.getPane('protected').style.zIndex = 350;
  map.createPane('dayhi'); map.getPane('dayhi').style.zIndex = 410;
  map.createPane('routes'); map.getPane('routes').style.zIndex = 420;
  map.createPane('arrows'); map.getPane('arrows').style.zIndex = 590;
  map.on('click', () => closeSheet());
  map.on('contextmenu', (e) => openPoint(e.latlng));
  map.on('zoomend', () => { updateMarkerVisibility(); updateArrowVisibility(); });
  map.on('dragstart', () => { if (state.follow) setFollow(false); });
}

function setTiles(key) {
  const src = TILE_SOURCES[key] || TILE_SOURCES.topo;
  if (tileLayer) map.removeLayer(tileLayer);
  tileLayer = L.tileLayer(src.url, { maxNativeZoom: src.maxNativeZoom, maxZoom: 18, attribution: src.attribution, crossOrigin: true }).addTo(map);
  state.tiles = key; store.set('tiles', key);
}

function drawProtected() {
  routeLayers.protected = L.geoJSON(D.prot, {
    pane: 'protected', interactive: false,
    style: (f) => f.properties.national_park
      ? { color: '#b71c1c', weight: 2, fillColor: '#e53935', fillOpacity: 0.16, dashArray: '6 4' }
      : { color: '#ef6c00', weight: 1.2, fillColor: '#ffb74d', fillOpacity: 0.10 },
  });
}

function drawRoutes() {
  const mk = (coords, color, opts = {}) => {
    const g = L.layerGroup();
    L.polyline(coords, { pane: 'routes', color: '#fff', weight: (opts.weight || 4) + 3, opacity: 0.9, interactive: false }).addTo(g);
    L.polyline(coords, { pane: 'routes', color, weight: opts.weight || 4, opacity: 1, dashArray: opts.dash, interactive: false }).addTo(g);
    const hit = L.polyline(coords, { pane: 'routes', color: '#000', weight: 22, opacity: 0, interactive: true }).addTo(g);
    if (opts.onClick) hit.on('click', (e) => { L.DomEvent.stopPropagation(e); opts.onClick(e); });
    return g;
  };
  const ll = (f) => f.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  routeLayers.GR132 = L.layerGroup();
  routeLayers.GR131 = L.layerGroup();
  routeLayers.ALT = L.layerGroup();
  for (const f of D.routes.features) {
    const p = f.properties;
    if (p.route === 'GR132') mk(ll(f), ROUTES.GR132.color, { onClick: (e) => openRoute('GR132', e.latlng, p.stage) }).addTo(routeLayers.GR132);
    if (p.route === 'GR131') mk(ll(f), ROUTES.GR131.color, { onClick: (e) => openRoute('GR131', e.latlng) }).addTo(routeLayers.GR131);
    if (p.route === 'GR131-EXC') mk(ll(f), ROUTES.GR131.color, { dash: '2 6', weight: 3 }).addTo(routeLayers.GR131);
    if (p.route === 'GR132-ALT') mk(ll(f), ROUTES.GR132.color, { dash: '8 7', weight: 3, onClick: (e) => openRoute('ALT', e.latlng) }).addTo(routeLayers.ALT);
  }
  // direction arrows every 1 km, km labels every 5 km
  arrowLayer = L.layerGroup();
  kmLayer = L.layerGroup();
  const addArrows = (key, color, step, label) => {
    const P = prof[key];
    let next = step / 2, nextKm = 5000;
    for (let i = 0; i < P.length - 2; i++) {
      if (P[i][0] >= next) {
        const b = G.bearing([P[i][2], P[i][3]], [P[i + 2][2], P[i + 2][3]]);
        L.marker([P[i][3], P[i][2]], {
          pane: 'arrows', interactive: false, keyboard: false, route: key,
          icon: L.divIcon({ className: '', iconSize: [18, 18], html: `<div class="arrow-icon" style="color:${color};text-shadow:0 0 2px #fff,0 0 3px #fff,0 0 4px #fff;transform:rotate(${b - 90}deg)">➤</div>` }),
        }).addTo(arrowLayer);
        next += step;
      }
      if (label && P[i][0] >= nextKm) {
        L.marker([P[i][3], P[i][2]], {
          pane: 'arrows', interactive: false, keyboard: false, route: key,
          icon: L.divIcon({ className: '', iconSize: [44, 16], iconAnchor: [-6, 8], html: `<div class="km-icon" style="border-color:${color}">${label} ${Math.round(nextKm / 1000)}</div>` }),
        }).addTo(kmLayer);
        nextKm += 5000;
      }
    }
  };
  addArrows('GR132', ROUTES.GR132.color, 1000, 'km');
  addArrows('GR131', ROUTES.GR131.color, 1000, '131·km');
  addArrows('ALT', ROUTES.GR132.color, 1000, null);
  dayHiLayer = L.layerGroup().addTo(map);
}

function applyRouteVisibility() {
  for (const k of Object.keys(ROUTES)) {
    const l = routeLayers[k];
    if (!l) continue;
    if (state.routes[k]) l.addTo(map); else map.removeLayer(l);
  }
  updateArrowVisibility();
}
function updateArrowVisibility() {
  const z = map.getZoom();
  const routeOf = (m) => (m.options.route === 'ALT' ? 'ALT' : m.options.route);
  for (const [layer, minZ] of [[arrowLayer, 13], [kmLayer, 12]]) {
    if (z >= minZ) {
      layer.addTo(map);
      layer.eachLayer((m) => { const on = state.routes[routeOf(m)]; m.setOpacity(on ? 1 : 0); });
    } else map.removeLayer(layer);
  }
}

function poiIcon(p) {
  const c = CATS[p.cat];
  const cls = [p.cat === 'camp_official' ? 'official' : p.cat, p.reliability === 'defekt' ? 'broken' : '', p.coord_confidence === 'low' ? 'lowconf' : ''].join(' ');
  const day = D.planCamp.get(p.id);
  const badge = day ? `<span class="n">T${day}</span>` : '';
  let bg = c.color;
  if (p.cat === 'water' && p.reliability === 'niedrig') bg = '#64a8d8';
  if (p.cat === 'camp_official' && p.status === 'closed') bg = '#9e9e9e';
  return L.divIcon({ className: '', iconSize: [c.size, c.size], html: `<div class="poi-icon ${cls}" style="background:${bg}">${c.icon}${badge}</div>` });
}

function drawMarkers() {
  for (const k of Object.keys(CATS)) { catLayers[k]?.remove(); catLayers[k] = L.layerGroup(); }
  markers.clear();
  for (const p of allPois()) {
    const z = D.planCamp.has(p.id) ? 2000 : p.cat === 'wildcamp' || p.cat === 'camp_official' ? 1000 : p.cat === 'water' ? 500 : 0;
    const m = L.marker([p.lat, p.lon], { icon: poiIcon(p), zIndexOffset: z, title: p.name, riseOnHover: true })
      .on('click', (e) => { L.DomEvent.stopPropagation(e); openPoi(p); });
    m.addTo(catLayers[p.cat]);
    markers.set(p.id, m);
  }
  updateMarkerVisibility();
}
function updateMarkerVisibility() {
  const z = map.getZoom();
  for (const [k, c] of Object.entries(CATS)) {
    const show = state.cats[k] && z >= c.minZoom;
    if (show) catLayers[k].addTo(map); else map.removeLayer(catLayers[k]);
  }
}

// ---------- chips ----------
function renderChips() {
  const el = $('#chips');
  const catChips = Object.entries(CATS).filter(([k]) => k !== 'own' || state.own.length)
    .map(([k, c]) => `<button class="chip ${state.cats[k] ? 'on' : 'off'}" data-cat="${k}">${c.icon} ${c.label}</button>`);
  const routeChips = Object.entries(ROUTES).map(([k, r]) =>
    `<button class="chip ${state.routes[k] ? 'on' : 'off'}" data-route="${k}"><span class="dot" style="background:${k === 'protected' ? '#ffb74d' : r.color}"></span>${r.label}</button>`);
  el.innerHTML = [...catChips, ...routeChips].join('');
}
$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  if (b.dataset.cat) {
    const k = b.dataset.cat;
    state.cats[k] = !state.cats[k];
    store.set('cats', state.cats);
    updateMarkerVisibility();
    if (state.cats[k] && map.getZoom() < CATS[k].minZoom) toast(`${CATS[k].label} erscheinen erst beim Hineinzoomen (ab Zoomstufe ${CATS[k].minZoom}).`);
  } else {
    const k = b.dataset.route;
    state.routes[k] = !state.routes[k];
    store.set('routes', state.routes);
    applyRouteVisibility();
  }
  renderChips();
});

// ---------- bottom sheet ----------
const sheet = $('#sheet');
function openSheet(html, { full = false } = {}) {
  $('#sheet-body').innerHTML = html;
  $('#sheet-body').scrollTop = 0;
  sheet.classList.add('open');
  sheet.classList.toggle('full', full);
  sheet.setAttribute('aria-hidden', 'false');
  document.body.classList.add('sheet-open');
  requestAnimationFrame(updateSheetHeight);
}
function closeSheet() {
  if (sheet.contains(document.activeElement)) document.activeElement.blur();
  sheet.classList.remove('open', 'full');
  sheet.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('sheet-open');
  currentSheet = null;
}
function updateSheetHeight() {
  document.documentElement.style.setProperty('--sheet-h', sheet.classList.contains('open') ? `${Math.min(sheet.offsetHeight, window.innerHeight * 0.55)}px` : '0px');
}
$('#sheet-close').addEventListener('click', closeSheet);
{
  let y0 = null;
  const h = $('#sheet-handle');
  h.addEventListener('click', () => { sheet.classList.toggle('full'); setTimeout(updateSheetHeight, 250); });
  h.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  h.addEventListener('touchend', (e) => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0;
    y0 = null;
    if (dy > 50) { if (sheet.classList.contains('full')) sheet.classList.remove('full'); else closeSheet(); }
    else if (dy < -40) sheet.classList.add('full');
    setTimeout(updateSheetHeight, 250);
  });
}
$('#sheet-body').addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const { act, id, lat, lon } = a.dataset;
  if (act === 'poi') { const p = allPois().find((x) => x.id === id); if (p) { showView('map'); flyTo(p); openPoi(p); } }
  if (act === 'zoom') { showView('map'); map.setView([+lat, +lon], Math.max(map.getZoom(), 16)); }
  if (act === 'copy') { navigator.clipboard?.writeText(`${lat}, ${lon}`).then(() => toast('Koordinaten kopiert')); }
  if (act === 'save-own') saveOwn(+lat, +lon);
  if (act === 'del-own' && confirmTap(a)) deleteOwn(id);
  if (act === 'day') showDayOnMap(+a.dataset.day);
});

// ---------- formatting helpers ----------
function badgeOpen(p, date) {
  if (!p.oh) return p.hours ? '<span class="badge b-unknown">Zeiten s. Text</span>' : '';
  const s = ohStatus(p.oh, date || canaryNow());
  return `<span class="badge b-${s.state}">${esc(s.label)}</span>`;
}
function badgeProt(p) {
  if (p.np) return '<span class="badge b-np">Nationalpark – Zelten verboten</span>';
  if (p.protected?.length) return '<span class="badge b-prot">Schutzgebiet</span>';
  return '';
}
const relLabel = { hoch: 'zuverlässig', mittel: 'wahrscheinlich ok', niedrig: 'unsicher', defekt: 'defekt / kein Trinkwasser' };
function routeFacts(p) {
  const out = [];
  if (p.r?.GR132) out.push(`<div class="fact"><small>GR 132</small><b>km ${kmStr(p.r.GR132[0])}</b><br><span class="muted">${G.fmtKm(p.r.GR132[1])} vom Weg</span></div>`);
  if (p.r?.GR131) out.push(`<div class="fact"><small>GR 131</small><b>km ${kmStr(p.r.GR131[0])}</b><br><span class="muted">${G.fmtKm(p.r.GR131[1])} vom Weg</span></div>`);
  if (p.r?.['GR132-ALT'] && p.r['GR132-ALT'][1] < 1000) out.push(`<div class="fact"><small>Variante</small><b>km ${kmStr(p.r['GR132-ALT'][0])}</b><br><span class="muted">${G.fmtKm(p.r['GR132-ALT'][1])} vom Weg</span></div>`);
  if (state.me) {
    const d = G.dist([state.me.lon, state.me.lat], [p.lon, p.lat]);
    out.push(`<div class="fact"><small>Von dir (Luftlinie)</small><b>${G.fmtKm(d)}</b></div>`);
  }
  return out.join('');
}
// best-fitting route position: the route the POI is closest to
function primaryRoute(p) {
  const e = Object.entries(p.r || {}).filter(([k]) => k !== 'GR132-ALT').sort((a, b) => a[1][1] - b[1][1])[0];
  return e ? { route: e[0], km: e[1][0], off: e[1][1] } : null;
}
function planDayFor(route, km) {
  const days = D.plan.days.filter((d) => d.route === route);
  return days.find((d) => km >= d.from_km && km < d.to_km) || (days.length && km >= days.at(-1).to_km - 0.05 ? days.at(-1) : null);
}
function planDayOfPoi(p) {
  for (const d of D.plan.days) {
    const r = p.r?.[d.route];
    if (r && r[1] <= (NEAR[p.cat] || 1000) && r[0] >= d.from_km && r[0] <= d.to_km) return d;
  }
  return null;
}
const todayPlanDay = () => D.plan.days.find((d) => dayDate(d.day).toDateString() === canaryNow().toDateString()) || null;
// position along the whole tour in meters (GR 131 first, then GR 132)
const toTour = (route, d) => (route === 'GR132' ? D.L131 + d : d);
function poiTourDs(p) {
  const lim = NEAR[p.cat] || 800, out = [];
  if (p.r?.GR131 && p.r.GR131[1] <= lim) out.push(p.r.GR131[0] * 1000);
  if (p.r?.GR132 && p.r.GR132[1] <= lim) out.push(D.L131 + p.r.GR132[0] * 1000);
  return out;
}
function tourMarks(from, to) {
  const out = [];
  for (const p of D.pois) {
    const ok = (p.cat === 'wildcamp' && p.r) || (p.cat === 'water' && !['defekt', 'niedrig'].includes(p.reliability));
    if (!ok) continue;
    const lim = p.cat === 'wildcamp' ? 400 : 300;
    for (const [route, base] of [['GR131', 0], ['GR132', D.L131]]) {
      const r = p.r[route];
      if (!r || r[1] > lim) continue;
      const d = base + r[0] * 1000;
      if (d >= from && d <= to) out.push({ d, icon: p.cat === 'water' ? '💧' : '⛺', color: p.cat === 'water' ? '#0277bd' : '#2e7d32' });
    }
  }
  return out;
}
function sourcesHtml(list) {
  if (!list?.length) return '';
  return `<details class="more"><summary>Quellen (${list.length})</summary><ol class="sources">${list.map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/, ''))}</a></li>`).join('')}</ol></details>`;
}
function navButtons(lat, lon, name) {
  const q = encodeURIComponent(name || '');
  return `<div class="actions">
    <a class="btn primary" href="geo:${lat},${lon}?q=${lat},${lon}(${q})">🧭 Navigation</a>
    <a class="btn" href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}" target="_blank" rel="noopener">Google Maps</a>
    <button class="btn" data-act="copy" data-lat="${lat}" data-lon="${lon}">📋 Koordinaten</button>
  </div>`;
}

// ---------- POI sheet ----------
function openPoi(p) {
  currentSheet = p.id;
  const c = CATS[p.cat];
  const now = canaryNow();
  const pr = primaryRoute(p);
  const planDay = planDayOfPoi(p);
  const campDay = D.planCamp.get(p.id);
  const parts = [];
  parts.push(`<h2>${c.icon} ${esc(p.name)}</h2>`);
  parts.push(`<div class="sub">${esc(c.label)}${p.sub ? ' · ' + esc(p.sub) : ''}${p.village ? ' · ' + esc(p.village) : ''}${p.between ? ' · ' + esc(p.between) : ''}</div>`);
  const badges = [badgeOpen(p, now), badgeProt(p)];
  if (p.reliability) badges.push(`<span class="badge b-rel-${p.reliability}">Wasser: ${relLabel[p.reliability]}</span>`);
  if (p.coord_confidence === 'low') badges.push('<span class="badge b-off">Position ungefähr (Suchbereich)</span>');
  if (p.coord_confidence === 'medium' && p.cat === 'wildcamp') badges.push('<span class="badge b-unknown">Position ± einige 100 m</span>');
  if (p.rating) badges.push(`<span class="stars" title="Einschätzung">${'★'.repeat(p.rating)}${'☆'.repeat(5 - p.rating)}</span>`);
  if (p.status === 'closed') badges.push('<span class="badge b-closed">Ende Nov. vermutlich geschlossen</span>');
  parts.push(`<div>${badges.filter(Boolean).join(' ')}</div>`);
  if (campDay) parts.push(`<div class="info">⛺ Geplantes Nachtlager für <b>Tag ${campDay}</b> (${fmtDate(dayDate(campDay))}) im 8-Tage-Plan.</div>`);
  parts.push(`<div class="facts">${routeFacts(p)}</div>`);

  if (p.cat === 'wildcamp' || p.cat === 'camp_official') {
    const d = p.details || {};
    const rows = [['Untergrund', d.ground], ['Windschutz', d.wind], ['Sichtschutz / Diskretion', d.privacy], ['Wasser in der Nähe', d.water], ['Schutzgebiet (Bericht)', d.protected_area],
      ['Öffnung', p.hours], ['Kosten', d.cost], ['Anmeldung / Genehmigung', d.permit], ['Ausstattung', d.facilities]].filter(([, v]) => v);
    parts.push(`<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`);
    if (p.notes_text) parts.push(`<dl class="kv"><dt>Aus den Berichten</dt><dd>${esc(p.notes_text)}</dd></dl>`);
  } else {
    if (p.hours) {
      parts.push(`<dl class="kv"><dt>Öffnungszeiten (Stand Recherche Nov. 2026)</dt><dd class="hours">${esc(p.hours)}</dd>${p.hours_conf ? `<dd class="muted">Verlässlichkeit: ${esc(p.hours_conf)}</dd>` : ''}</dl>`);
    } else if (['supermarket', 'snack', 'restaurant'].includes(p.cat)) {
      parts.push('<div class="muted">Keine Öffnungszeiten bekannt. Typisch auf La Gomera: Läden Mo–Fr ca. 08:30–13:30 und 16:30/17:00–20:00, Sa vormittags, So meist zu. Restaurants mit Ruhetag.</div>');
    }
    if (planDay && p.oh) {
      const dd = dayDate(planDay.day);
      parts.push(`<div class="info">Laut Plan kommst du an <b>Tag ${planDay.day}, ${fmtDate(dd)}</b> vorbei: ${esc(dayLabel(p.oh, dd) || '?')}</div>`);
    }
    if (p.desc) parts.push(`<dl class="kv"><dt>Info</dt><dd>${esc(p.desc)}</dd></dl>`);
    if (p.note && p.cat !== 'own') parts.push(`<dl class="kv"><dt>Hinweis aus der Recherche</dt><dd>${esc(p.note)}</dd></dl>`);
  }
  if (p.cat === 'own' && p.note) parts.push(`<dl class="kv"><dt>Notiz</dt><dd>${esc(p.note)}</dd></dl>`);
  const prot = protectedAt(p.lat, p.lon);
  for (const a of prot) parts.push(`<div class="${a.national_park ? 'danger' : 'warn'}"><b>${esc(a.name)}</b><br>${esc(a.rule)}</div>`);
  if (pr && p.cat !== 'own' && pr.off > 300) parts.push(`<div class="muted">Liegt ${G.fmtKm(pr.off)} abseits vom ${pr.route.replace('GR', 'GR ')} (Luftlinie, der Weg dorthin ist oft länger und steiler).</div>`);
  parts.push(navButtons(p.lat, p.lon, p.name));
  if (p.cat === 'own') parts.push(`<div class="actions"><button class="btn danger" data-act="del-own" data-id="${esc(p.id)}">🗑 Eigenen Punkt löschen</button></div>`);
  parts.push(sourcesHtml(p.sources));
  openSheet(parts.join(''));
  ensureVisible(p.lat, p.lon);
}

// pan the map so a point isn't hidden behind the bottom sheet
function ensureVisible(lat, lon) {
  requestAnimationFrame(() => {
    const pt = map.latLngToContainerPoint([lat, lon]);
    const h = map.getSize().y - sheet.offsetHeight - 30;
    if (pt.y > h || pt.y < 120) map.panBy([0, pt.y - Math.max(140, h / 2)], { animate: true });
  });
}
function flyTo(p) { map.setView([p.lat, p.lon], Math.max(map.getZoom(), 15)); }

// ---------- route sheet ----------
function profileSVG(P, from, to, { marks = [], cur = null, kmOffset = 0, relative = false } = {}) {
  const pts = P.filter((s) => s[0] >= from && s[0] <= to);
  if (pts.length < 2) return '';
  const W = 600, H = 150, pl = 36, pr = 8, pt = 18, pb = 18;
  const es = pts.map((p) => p[1]);
  const lo = Math.floor(Math.min(...es) / 100) * 100, hi = Math.max(lo + 200, Math.ceil(Math.max(...es) / 100) * 100);
  const X = (d) => pl + ((d - from) / (to - from)) * (W - pl - pr);
  const Y = (e) => pt + (1 - (e - lo) / (hi - lo)) * (H - pt - pb);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const area = `${line}L${X(pts.at(-1)[0]).toFixed(1)},${H - pb}L${X(pts[0][0]).toFixed(1)},${H - pb}Z`;
  const stepE = hi - lo > 800 ? 400 : 200;
  let grid = '';
  for (let e = Math.ceil(lo / stepE) * stepE; e <= hi; e += stepE) grid += `<line x1="${pl}" x2="${W - pr}" y1="${Y(e)}" y2="${Y(e)}" stroke="#e1e6e3"/><text x="${pl - 4}" y="${Y(e) + 3}" text-anchor="end">${e}</text>`;
  const spanKm = (to - from) / 1000;
  const stepK = spanKm > 60 ? 10 : spanKm > 25 ? 5 : spanKm > 10 ? 2 : 1;
  if (relative) for (let k = 0; from + k * 1000 <= to; k += stepK) grid += `<text x="${X(from + k * 1000)}" y="${H - 4}" text-anchor="middle">+${k}</text>`;
  else for (let k = Math.ceil(from / 1000 / stepK) * stepK; k <= to / 1000; k += stepK) grid += `<text x="${X(k * 1000)}" y="${H - 4}" text-anchor="middle">${k + kmOffset}</text>`;
  const mk = marks.filter((m) => m.d >= from && m.d <= to).map((m) => `<text x="${X(m.d)}" y="13" text-anchor="middle" style="font-size:12px">${m.icon}</text><line x1="${X(m.d)}" x2="${X(m.d)}" y1="15" y2="${H - pb}" stroke="${m.color || '#999'}" stroke-dasharray="2 3"/>`).join('');
  const c = cur != null && cur >= from && cur <= to ? `<line x1="${X(cur)}" x2="${X(cur)}" y1="${pt}" y2="${H - pb}" stroke="#1a73e8" stroke-width="3"/>` : '';
  return `<svg class="profile" viewBox="0 0 ${W} ${H}" role="img" aria-label="Höhenprofil">${grid}<path d="${area}" fill="#cfe3d6"/><path d="${line}" fill="none" stroke="#1f3b2d" stroke-width="2"/>${mk}${c}</svg>`;
}
function routeMarks(route, from, to) {
  const key = route === 'ALT' ? 'GR132-ALT' : route;
  const out = [];
  for (const p of D.pois) {
    const r = p.r?.[key];
    if (!r || r[0] * 1000 < from || r[0] * 1000 > to) continue;
    if (p.cat === 'wildcamp' && r[1] < 400) out.push({ d: r[0] * 1000, icon: '⛺', color: '#2e7d32' });
    if (p.cat === 'water' && r[1] < 300 && p.reliability !== 'defekt' && p.reliability !== 'niedrig') out.push({ d: r[0] * 1000, icon: '💧', color: '#0277bd' });
  }
  return out;
}
function openRoute(route, latlng, stageNo) {
  const P = prof[route];
  const n = latlng ? G.nearest(P, [latlng.lng, latlng.lat]) : null;
  const parts = [];
  if (route === 'GR132') {
    const st = D.stages.find((s) => s.stage === stageNo) || D.stages[0];
    const total = D.stages.reduce((a, s) => ({ km: a.km + s.distance_m, up: a.up + s.ascent_m, down: a.down + s.descent_m }), { km: 0, up: 0, down: 0 });
    parts.push(`<h2>GR 132 – Etappe ${st.stage}</h2><div class="sub">${esc(st.from)} → ${esc(st.to)} · gegen den Uhrzeigersinn · offizielle Etappe des „Camino Natural Costas de La Gomera“</div>`);
    parts.push(`<div class="facts"><div class="fact"><small>Distanz</small><b>${G.fmtKm(st.distance_m)}</b></div><div class="fact"><small>Aufstieg</small><b>↑ ${st.ascent_m} m</b></div><div class="fact"><small>Abstieg</small><b>↓ ${st.descent_m} m</b></div><div class="fact"><small>Höhe</small><b>${st.min_ele}–${st.max_ele} m</b></div><div class="fact"><small>Gehzeit (DIN)</small><b>${G.fmtDur(G.hikeMinutes(st.distance_m / 1000, st.ascent_m, st.descent_m))}</b></div></div>`);
    if (n) { const dd = planDayFor('GR132', n.d / 1000); parts.push(`<div class="info">Angetippt: <b>km ${kmStr(n.d / 1000)}</b> der Runde, ${n.ele} m Höhe${dd ? ` · Plan-Tag ${dd.day}` : ''}</div>`); }
    parts.push(profileSVG(P, st.start, st.end, { marks: routeMarks('GR132', st.start, st.end), cur: n?.d }));
    parts.push(`<p class="muted">Gesamte Runde: ${G.fmtKm(total.km)}, ↑ ${total.up} m, ↓ ${total.down} m (Höhen aus Copernicus DEM 90 m, geglättet). Die Kilometerangaben in der App beziehen sich auf die Runde ab San Sebastián.</p>`);
    parts.push(profileSVG(P, 0, total.km, { marks: D.plan.days.filter((d) => d.route === 'GR132').map((d) => ({ d: d.to_km * 1000, icon: `${d.day}`, color: '#b8860b' })), cur: n?.d }));
  } else {
    const f = D.routes.features.find((x) => x.properties.route === (route === 'ALT' ? 'GR132-ALT' : 'GR131')).properties;
    parts.push(`<h2>${route === 'ALT' ? 'GR 132 – Variante (Alternativa)' : 'GR 131: Vallehermoso → San Sebastián'}</h2>`);
    parts.push(`<div class="sub">${route === 'ALT' ? 'Inlandsvariante von Juego de Bolas über den Ort Vallehermoso nach Epina. Sie ersetzt die Küste über Playa de Vallehermoso und Santa Clara.' : `Über die Inselmitte: ${esc((f.via || '').replace(/;/g, ' · '))}`}</div>`);
    parts.push(`<div class="facts"><div class="fact"><small>Distanz</small><b>${G.fmtKm(f.distance_m)}</b></div><div class="fact"><small>Aufstieg</small><b>↑ ${f.ascent_m} m</b></div><div class="fact"><small>Abstieg</small><b>↓ ${f.descent_m} m</b></div><div class="fact"><small>Höhe</small><b>${f.min_ele}–${f.max_ele} m</b></div><div class="fact"><small>Gehzeit (DIN)</small><b>${G.fmtDur(G.hikeMinutes(f.distance_m / 1000, f.ascent_m, f.descent_m))}</b></div></div>`);
    if (n) { const dd = route === 'GR131' ? planDayFor('GR131', n.d / 1000) : null; parts.push(`<div class="info">Angetippt: <b>km ${kmStr(n.d / 1000)}</b>, ${n.ele} m Höhe${dd ? ` · Plan-Tag ${dd.day}` : ''}</div>`); }
    const dayMarks = D.plan.days.filter((d) => d.route === route).map((d) => ({ d: d.to_km * 1000, icon: `${d.day}`, color: '#b8860b' }));
    parts.push(profileSVG(P, 0, f.distance_m, { marks: [...routeMarks(route, 0, f.distance_m), ...dayMarks], cur: n?.d }));
    if (route === 'GR131') parts.push(`<div class="danger">Nationalpark Garajonay auf ca. km 10–14 und km 21–31: Zelten und Biwakieren streng verboten. Vor der Dunkelheit aus dem Park heraus sein!</div><div class="info">${esc(D.plan.extra.gr131)}</div>`);
  }
  openSheet(parts.join(''));
}

// long-press on the map
function openPoint(latlng) {
  const lat = +latlng.lat.toFixed(5), lon = +latlng.lng.toFixed(5);
  const r = routePos(lat, lon);
  const prot = protectedAt(lat, lon);
  const parts = [`<h2>📍 Punkt auf der Karte</h2><div class="sub">${lat}, ${lon}</div>`];
  parts.push(`<div class="facts">${routeFacts({ r, lat, lon })}</div>`);
  if (!prot.length) parts.push('<div class="info">Kein ausgewiesenes Schutzgebiet (amtliche Karte GRAFCAN). Wildcampen ist trotzdem überall auf La Gomera offiziell verboten, diskret und spurlos wird es laut Berichten aber meist toleriert.</div>');
  for (const a of prot) parts.push(`<div class="${a.national_park ? 'danger' : 'warn'}"><b>${esc(a.name)}</b><br>${esc(a.rule)}</div>`);
  parts.push(`<details class="more"><summary>📌 Als eigenen Punkt speichern</summary>
    <div class="own-form"><input id="own-name" type="text" placeholder="Name, z. B. „Quelle läuft“, „Guter Zeltplatz“" maxlength="80">
    <textarea id="own-note" rows="2" placeholder="Notiz (optional)"></textarea>
    <button class="btn primary" data-act="save-own" data-lat="${lat}" data-lon="${lon}">Speichern</button></div></details>`);
  parts.push(navButtons(lat, lon, 'Punkt'));
  openSheet(parts.join(''));
}
function saveOwn(lat, lon) {
  const name = $('#own-name')?.value.trim() || 'Mein Punkt';
  const note = $('#own-note')?.value.trim() || '';
  const p = { id: 'own-' + Date.now(), cat: 'own', name: name || 'Mein Punkt', note, lat, lon, created: new Date().toISOString(), sources: [] };
  p.r = routePos(lat, lon);
  state.own.push(p);
  store.set('own', state.own.map(({ r, ...x }) => x));
  state.cats.own = true;
  drawMarkers(); renderChips();
  openPoi(p);
  toast('Gespeichert (nur auf diesem Gerät)');
}
// destructive buttons need a second tap instead of confirm() (not available in every WebView)
function confirmTap(btn, label = 'Nochmal tippen zum Bestätigen') {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1';
  const old = btn.textContent;
  btn.textContent = label;
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = old; }, 4000);
  return false;
}
function deleteOwn(id) {
  state.own = state.own.filter((p) => p.id !== id);
  store.set('own', state.own.map(({ r, ...x }) => x));
  drawMarkers(); renderChips(); closeSheet();
}

// ---------- GPS ----------
function startGps() {
  if (!('geolocation' in navigator)) { toast('GPS wird von diesem Browser nicht unterstützt'); return; }
  if (state.watching) return;
  state.watching = true;
  $('#btn-locate').classList.add('active');
  navigator.geolocation.watchPosition(onPos, (err) => {
    state.watching = false;
    $('#btn-locate').classList.remove('active', 'follow');
    toast(err.code === 1 ? 'Standortzugriff verweigert. Bitte in den Browser-Einstellungen erlauben (HTTPS oder localhost nötig).' : 'Kein GPS-Signal: ' + err.message, 5000);
  }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 60000 });
}
function onPos(pos) {
  const { latitude: lat, longitude: lon, accuracy: acc } = pos.coords;
  const first = !meMarker;
  state.me = { lat, lon, acc, t: Date.now() };
  store.set('lastPos', state.me);
  drawMe();
  if (first || state.follow) map.setView([lat, lon], first ? Math.max(map.getZoom(), 15) : map.getZoom());
  updateStatus();
}
function drawMe(stale = false) {
  if (!state.me) return;
  const ll = [state.me.lat, state.me.lon];
  if (!meMarker) {
    meCircle = L.circle(ll, { radius: state.me.acc || 30, color: '#1a73e8', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
    meMarker = L.marker(ll, { icon: L.divIcon({ className: '', iconSize: [22, 22], html: `<div class="me-dot ${stale ? 'stale' : ''}"></div>` }), zIndexOffset: 3000, interactive: false }).addTo(map);
  } else {
    meMarker.setLatLng(ll);
    meCircle.setLatLng(ll).setRadius(state.me.acc || 30);
    if (!stale) meMarker.setIcon(L.divIcon({ className: '', iconSize: [22, 22], html: '<div class="me-dot"></div>' }));
  }
}
function setFollow(on) {
  state.follow = on;
  $('#btn-locate').classList.toggle('follow', on);
}
$('#btn-locate').addEventListener('click', () => {
  if (!state.watching) { startGps(); setFollow(true); toast('Suche GPS … (Folgemodus an)'); return; }
  if (state.me) map.setView([state.me.lat, state.me.lon], Math.max(map.getZoom(), 15));
  setFollow(!state.follow);
  toast(state.follow ? 'Karte folgt deiner Position' : 'Folgemodus aus');
});

// where am I on the routes?
function myRoutePos() {
  if (!state.me) return null;
  const p = [state.me.lon, state.me.lat];
  const res = [];
  for (const k of ['GR132', 'GR131', 'ALT']) { const n = G.nearest(prof[k], p); res.push({ route: k, ...n }); }
  res.sort((a, b) => a.off - b.off);
  // shared sections (Playa de Vallehermoso, San Sebastián): prefer the route of today's plan day
  const t = todayPlanDay();
  const pref = t && res.find((r) => r.route === t.route);
  if (pref && pref.off < 150 && res[0].off < 150) return pref;
  return res[0];
}

function updateStatus() {
  const el = $('#status');
  const now = new Date();
  const sun = G.sunTimes(now, 28.11, -17.24);
  const parts = [];
  const mp = myRoutePos();
  if (mp && mp.off < 3000) {
    const name = mp.route === 'ALT' ? 'Variante' : mp.route.replace('GR', 'GR ');
    let s = `📍 <b>${name} km ${kmStr(mp.d / 1000)}</b> · ${mp.ele} m`;
    if (mp.off > 60) s += ` · <b>${G.fmtKm(mp.off)} neben dem Weg</b>`;
    if (mp.route !== 'ALT') { const d = planDayFor(mp.route, mp.d / 1000); if (d) s += ` · Tag ${d.day}`; }
    parts.push(s);
    const prot = protectedAt(state.me.lat, state.me.lon);
    if (prot.some((a) => a.national_park)) parts.push('⚠️ <b>Im Nationalpark – Zelten/Biwak verboten</b>');
    else if (prot.length) parts.push(`⚠️ ${esc(prot[0].name)} (Zelten verboten)`);
  } else if (mp) parts.push(`📍 ${G.fmtKm(mp.off)} von den Routen entfernt`);
  const mins = Math.round((sun.set - now) / 60000);
  if (mins > 0 && mins < 12 * 60) parts.push(`🌇 Sonnenuntergang ${fmtTime(sun.set)} (in ${G.fmtDur(mins)})`);
  else parts.push(`🌅 ${fmtTime(sun.rise)} · 🌇 ${fmtTime(sun.set)}`);
  if (state.me && Date.now() - state.me.t > 10 * 60000) parts.push(`<span style="opacity:.8">letzte Position vor ${G.fmtDur(Math.round((Date.now() - state.me.t) / 60000))}</span>`);
  el.innerHTML = parts.join('<br>');
  el.classList.toggle('hidden', !parts.length);
}

// ---------- "what's ahead" ----------
// next POIs in walking direction; on GR 131/132 this follows the whole tour (GR 131 continues into GR 132)
function aheadItems(ref, cats, maxPer = 3) {
  const tour = ref.route !== 'ALT';
  const P = tour ? prof.TOUR : prof.ALT;
  const from = tour ? toTour(ref.route, ref.d) : ref.d;
  const out = {};
  for (const cat of cats) {
    const items = [];
    for (const p of allPois()) {
      if (p.cat !== cat || p.reliability === 'defekt' || p.status === 'closed') continue;
      const alt = p.r?.['GR132-ALT'];
      const ds = tour ? poiTourDs(p) : alt && alt[1] <= (NEAR[cat] || 800) ? [alt[0] * 1000] : [];
      const d = ds.filter((x) => x > from + 50).sort((a, b) => a - b)[0];
      if (d != null) items.push({ p, d });
    }
    out[cat] = items.sort((a, b) => a.d - b.d).slice(0, maxPer).map(({ p, d }) => {
      const c = G.climb(P, from, d);
      return { p, dKm: (d - from) / 1000, ...c, min: G.hikeMinutes((d - from) / 1000, c.up, c.down, 1.1) };
    });
  }
  return { res: out, P, from, tour };
}
function openAhead() {
  let ref = myRoutePos();
  let usingCenter = false;
  if (!ref || ref.off > 3000) {
    const c = map.getCenter();
    const cands = ['GR132', 'GR131', 'ALT'].map((k) => ({ route: k, ...G.nearest(prof[k], [c.lng, c.lat]) })).sort((a, b) => a.off - b.off);
    ref = cands[0];
    usingCenter = true;
  }
  const cats = ['water', 'supermarket', 'snack', 'restaurant', 'wildcamp', 'camp_official'];
  const { res, P, from, tour } = aheadItems(ref, cats, 3);
  const now = canaryNow();
  const name = ref.route === 'ALT' ? 'Variante' : ref.route.replace('GR', 'GR ');
  const parts = [`<h2>⏭ Was kommt als Nächstes?</h2><div class="sub">${usingCenter ? '⚠️ Ohne GPS-Fix: ab <b>Kartenmitte</b>' : 'Ab deiner Position'}: ${name} km ${kmStr(ref.d / 1000)} in Laufrichtung${tour ? ' (Tour: GR 131 → GR 132)' : ''}. Gehzeit nach DIN 33466 +10 % (Rucksack), ohne Pausen.</div>`];
  const sun = G.sunTimes(new Date(), 28.11, -17.24);
  for (const cat of cats) {
    const items = res[cat];
    if (!items.length) continue;
    parts.push(`<h3 style="margin:14px 0 4px">${CATS[cat].icon} ${CATS[cat].label}</h3><div class="list">`);
    for (const it of items) {
      const eta = new Date(now.getTime() + it.min * 60000);
      const st = it.p.oh ? ohStatus(it.p.oh, eta) : null;
      const etaReal = new Date(Date.now() + it.min * 60000);
      const sameDay = etaReal.toLocaleDateString('de-DE', { timeZone: TZ }) === new Date().toLocaleDateString('de-DE', { timeZone: TZ });
      const etaStr = (sameDay ? '' : etaReal.toLocaleDateString('de-DE', { weekday: 'short', timeZone: TZ }) + ' ') + fmtTime(etaReal);
      const dark = sameDay && etaReal > sun.set;
      parts.push(`<button class="item" data-act="poi" data-id="${esc(it.p.id)}"><span class="ico" style="background:${CATS[cat].color}">${CATS[cat].icon}</span>
        <span><span class="t">${esc(it.p.name)}</span><span class="s">${st ? `<span class="badge b-${st.state}">bei Ankunft: ${esc(st.label)}</span>` : ''}${it.p.reliability ? `<span class="badge b-rel-${it.p.reliability}">${relLabel[it.p.reliability]}</span>` : ''}${badgeProt(it.p)}${dark ? '<span class="badge b-closed">nach Sonnenuntergang</span>' : ''}</span></span>
        <span class="r"><b>+${kmStr(it.dKm)} km</b>↑${it.up} ↓${it.down}<br>~${G.fmtDur(it.min)} (${etaStr})</span></button>`);
    }
    parts.push('</div>');
  }
  if (tour && from < P.at(-1)[0] - 500) {
    const end = Math.min(from + 20000, P.at(-1)[0]);
    parts.push('<h3 style="margin:14px 0 4px">Die nächsten 20 km</h3>' + profileSVG(P, from, end, { marks: tourMarks(from, end), relative: true }));
  }
  openSheet(parts.join(''), { full: true });
}
$('#btn-ahead').addEventListener('click', openAhead);

// ---------- views ----------
function showView(v) {
  for (const b of document.querySelectorAll('#bottombar button')) b.classList.toggle('active', b.dataset.view === v);
  for (const p of ['list', 'plan', 'settings']) $(`#panel-${p}`).classList.toggle('hidden', p !== v);
  $('#fabs').classList.toggle('hidden', v !== 'map');
  $('#topbar').classList.toggle('hidden', v !== 'map');
  if (v !== 'map') closeSheet();
  if (v === 'list') renderList();
  if (v === 'plan') renderPlan();
  if (v === 'settings') renderSettings();
  if (v === 'map') setTimeout(() => map.invalidateSize(), 50);
}
document.querySelector('#bottombar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) showView(b.dataset.view);
});

// list
function renderListChips() {
  $('#list-chips').innerHTML = Object.entries(CATS).filter(([k]) => k !== 'own' || state.own.length)
    .map(([k, c]) => `<button class="chip ${state.listCats[k] ? 'on' : 'off'}" data-cat="${k}">${c.icon} ${c.label}</button>`).join('');
}
$('#list-chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  state.listCats[b.dataset.cat] = !state.listCats[b.dataset.cat];
  store.set('listCats', state.listCats);
  renderList();
});
$('#search').addEventListener('input', () => renderList());
$('#sort').addEventListener('change', () => renderList());
function renderList() {
  renderListChips();
  const q = $('#search').value.trim().toLowerCase();
  const sort = $('#sort').value;
  const now = canaryNow();
  let items = allPois().filter((p) => state.listCats[p.cat]);
  if (q) items = items.filter((p) => [p.name, p.sub, p.village, p.between, p.desc, p.note, p.notes_text].join(' ').toLowerCase().includes(q));
  let note = '';
  const me = state.me ? [state.me.lon, state.me.lat] : null;
  let val;
  if (sort === 'me') {
    if (!me) note = 'Noch keine GPS-Position: Unten rechts auf 📍 tippen. Sortiert nach Entfernung zur Kartenmitte.';
    const ref = me || [map.getCenter().lng, map.getCenter().lat];
    val = (p) => G.dist(ref, [p.lon, p.lat]);
    items.sort((a, b) => val(a) - val(b));
  } else if (sort === 'ahead') {
    const mp = myRoutePos();
    let from = 0;
    if (mp && mp.route !== 'ALT' && mp.off < 3000) from = toTour(mp.route, mp.d);
    else note = 'Keine GPS-Position auf der Tour: Liste ab dem Tourstart (Playa de Vallehermoso).';
    const pos = new Map();
    items = items.filter((p) => {
      const d = poiTourDs(p).filter((x) => x >= from).sort((a, b) => a - b)[0];
      if (d != null) pos.set(p.id, d);
      return d != null;
    });
    items.sort((a, b) => pos.get(a.id) - pos.get(b.id));
    val = (p) => pos.get(p.id) - from;
  } else {
    const key = sort === 'route131' ? 'GR131' : 'GR132';
    items = items.filter((p) => p.r?.[key] && p.r[key][1] <= (NEAR[p.cat] || 1000) * 2);
    items.sort((a, b) => a.r[key][0] - b.r[key][0]);
    note = `Nur Einträge in Gehweite des ${key.replace('GR', 'GR ')}, sortiert nach km in Laufrichtung.`;
  }
  const html = items.slice(0, 400).map((p) => {
    const c = CATS[p.cat];
    let right = '';
    if (sort === 'me') right = `<b>${G.fmtKm(val(p))}</b>Luftlinie`;
    else if (sort === 'ahead') right = `<b>+${kmStr(val(p) / 1000)} km</b>auf der Tour`;
    else { const k = sort === 'route131' ? 'GR131' : 'GR132'; right = `<b>km ${kmStr(p.r[k][0])}</b>${G.fmtKm(p.r[k][1])} ab Weg`; }
    const day = D.planCamp.get(p.id);
    const sub = [p.sub && p.sub !== p.name ? p.sub : c.label, p.village, day ? `Camp Tag ${day}` : ''].filter(Boolean).map(esc).join(' · ');
    return `<button class="item" data-id="${esc(p.id)}"><span class="ico" style="background:${c.color}">${c.icon}</span>
      <span><span class="t">${esc(p.name)}</span><span class="s">${badgeOpen(p, now)}${p.reliability ? `<span class="badge b-rel-${p.reliability}">${relLabel[p.reliability]}</span>` : ''}${badgeProt(p)}${sub}</span></span>
      <span class="r">${right}</span></button>`;
  }).join('');
  $('#list').innerHTML = (note ? `<div class="list-note">${esc(note)}</div>` : '') + (html || '<div class="list-note">Keine Einträge, Filter oder Suche anpassen.</div>') + `<div class="list-note">${items.length} Einträge</div>`;
}
$('#list').addEventListener('click', (e) => {
  const b = e.target.closest('.item');
  if (!b) return;
  const p = allPois().find((x) => x.id === b.dataset.id);
  if (!p) return;
  if (!state.cats[p.cat]) { state.cats[p.cat] = true; store.set('cats', state.cats); updateMarkerVisibility(); renderChips(); }
  showView('map');
  flyTo(p);
  openPoi(p);
});

// plan
function supplyForDay(d) {
  const date = dayDate(d.day);
  const lim = { water: 300, supermarket: 1500, snack: 500, restaurant: 500 };
  const R = d.route;
  return D.pois.filter((p) => lim[p.cat] && p.r?.[R] && p.r[R][1] <= lim[p.cat] && p.r[R][0] >= d.from_km - 0.3 && p.r[R][0] <= d.to_km + 0.3 && p.reliability !== 'defekt')
    .sort((a, b) => a.r[R][0] - b.r[R][0])
    .map((p) => {
      const hrs = p.oh ? dayLabel(p.oh, date) : null;
      const extra = p.cat === 'water' ? `<span class="badge b-rel-${p.reliability}">${relLabel[p.reliability]}</span>` : hrs ? `<span class="badge ${hrs === 'geschlossen' ? 'b-closed' : 'b-open'}">${esc(hrs)}</span>` : '<span class="badge b-unknown">Zeiten unklar</span>';
      return `<li><span>km ${kmStr(p.r[R][0])}</span> ${CATS[p.cat].icon} <button data-poi="${esc(p.id)}">${esc(p.name)}</button>${p.r[R][1] > 300 ? `<span class="muted">(${G.fmtKm(p.r[R][1])} abseits)</span>` : ''} ${extra}</li>`;
    });
}
function renderPlan() {
  const P = D.plan;
  const today = canaryNow();
  const tot = P.days.reduce((a, d) => ({ km: a.km + d.distance_km, up: a.up + d.ascent_m, down: a.down + d.descent_m }), { km: 0, up: 0, down: 0 });
  const tourGpx = D.gpx.find((g) => g.day === 0);
  const html = [`<h2>🥾 ${esc(P.title || '8-Tage-Plan')}</h2>
    <div class="facts"><div class="fact"><small>Gesamt</small><b>${kmStr(tot.km)} km</b></div><div class="fact"><small>Aufstieg</small><b>↑ ${tot.up} m</b></div><div class="fact"><small>Abstieg</small><b>↓ ${tot.down} m</b></div><div class="fact"><small>Start</small><b>${fmtDate(startDate())}</b></div></div>
    <p class="muted">Tag 1–2: GR 131 von der Playa de Vallehermoso nach San Sebastián (km ab Playa de Vallehermoso). Tag 3–8: GR 132 gegen den Uhrzeigersinn (km ab San Sebastián). Nachtlager sind Plätze aus Wanderberichten, Vorschläge ohne Berichte sind markiert. Öffnungszeiten werden für das jeweilige Datum ausgewertet. Das Startdatum kannst du unter „Offline“ ändern.</p>
    ${tourGpx ? `<div class="actions"><a class="btn" href="${esc(tourGpx.file)}" download>📥 GPX Gesamttour</a></div>` : ''}
    <details class="more"><summary>⚖️ Rechtslage Wildcampen & Tipps</summary><div class="warn">${esc(D.legal.summary)}</div><div class="info">${esc(D.legal.practice)}</div><ul>${D.legal.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>`];
  for (const d of P.days) {
    const date = dayDate(d.day);
    const isToday = date.toDateString() === today.toDateString();
    const sun = G.sunTimes(date, 28.11, -17.24);
    const camp = d.camp ? D.pois.find((p) => p.id === d.camp) : null;
    const alts = d.alt_camps.map((id) => D.pois.find((p) => p.id === id)).filter(Boolean);
    const sup = supplyForDay(d);
    const gpx = D.gpx.find((g) => g.day === d.day);
    html.push(`<div class="day ${isToday ? 'today' : ''}" id="day-${d.day}">
      <div class="day-head"><h3>Tag ${d.day}: ${esc(d.title)}</h3><span class="day-date">${fmtDate(date)}${isToday ? ' · HEUTE' : ''}</span></div>
      <div class="facts"><div class="fact"><small>Strecke</small><b>${kmStr(d.distance_km)} km</b><br><span class="muted">${d.route.replace('GR', 'GR ')} km ${kmStr(d.from_km)}–${kmStr(d.to_km)}</span></div><div class="fact"><small>Höhenmeter</small><b>↑${d.ascent_m} ↓${d.descent_m}</b></div><div class="fact"><small>Gehzeit*</small><b>${G.fmtDur(G.hikeMinutes(d.distance_km, d.ascent_m, d.descent_m))}</b></div><div class="fact"><small>Tageslicht</small><b>${fmtTime(sun.rise)}–${fmtTime(sun.set)}</b></div></div>
      ${profileSVG(prof[d.route], d.from_km * 1000, d.to_km * 1000, { marks: routeMarks(d.route, d.from_km * 1000, d.to_km * 1000) })}
      <p>${esc(d.summary)}</p>
      <p><span class="lbl">🛒 Essen:</span> ${esc(d.food)}</p>
      <p><span class="lbl">💧 Wasser:</span> ${esc(d.water)}</p>
      ${d.warnings ? `<div class="warn">${esc(d.warnings)}</div>` : ''}
      <p><span class="lbl">⛺ Nachtlager:</span> ${camp ? `<button class="btn" data-poi="${esc(camp.id)}">${esc(camp.name)}</button>${camp.unverified ? ' <span class="badge b-off">ohne Berichte – Vorschlag</span>' : ''}` : `<b>${esc(d.night || 'Ziel')}</b>`}</p>
      ${alts.length ? `<p class="muted">Alternativen: ${alts.map((a) => `<button class="btn" style="min-height:34px;padding:4px 8px;margin:2px" data-poi="${esc(a.id)}">${esc(a.name)}</button>`).join(' ')}</p>` : ''}
      <details class="more"><summary>Versorgung unterwegs (${sup.length}) – Zeiten am ${fmtDate(date)}</summary><ul class="mini-list">${sup.join('') || '<li>Nichts direkt am Weg.</li>'}</ul></details>
      <div class="actions"><button class="btn primary" data-day="${d.day}">🗺️ Etappe auf Karte</button>${gpx ? `<a class="btn" href="${esc(gpx.file)}" download>📥 GPX</a>` : ''}</div>
    </div>`);
  }
  html.push(`<p class="muted">* Reine Gehzeit nach DIN 33466 (4 km/h, 300 Hm/h hoch, 500 Hm/h runter), ohne Pausen. Mit schwerem Rucksack eher +10–20 %. Tageslicht Ende November nur ~10,5 h!</p>
    <h3>Puffer & Alternativen</h3><p>${esc(P.extra.buffer)}</p><p>${esc(P.extra.gr131)}</p><p>${esc(P.extra.bus)}</p>
    <h3>GPX für Komoot & Co.</h3><p>${esc(P.extra.gpx || '')}</p>
    <ul class="muted"><li><b>Komoot:</b> „📥 GPX“ herunterladen und die Datei mit Komoot öffnen, oder am PC/Browser unter Planen → „GPX importieren“. Komoot übernimmt den Track, aber keine Wegpunkte (die POIs findest du hier in der App).</li>
    <li><b>OsmAnd, Organic Maps, Locus, Gaia GPS, Garmin:</b> Track UND alle Wegpunkte (Camps, Wasser, Läden mit Öffnungszeiten) werden übernommen.</li></ul>`);
  const el = $('#panel-plan');
  el.innerHTML = html.join('');
  const t = el.querySelector('.day.today');
  if (t) t.scrollIntoView({ block: 'start' });
}
$('#panel-plan').addEventListener('click', (e) => {
  const b = e.target.closest('[data-poi],[data-day]');
  if (!b) return;
  if (b.dataset.day) { showDayOnMap(+b.dataset.day); return; }
  const p = D.pois.find((x) => x.id === b.dataset.poi);
  if (p) { showView('map'); flyTo(p); openPoi(p); }
});
function showDayOnMap(n) {
  const d = D.plan.days.find((x) => x.day === n);
  const seg = prof[d.route].filter((s) => s[0] >= d.from_km * 1000 && s[0] <= d.to_km * 1000).map((s) => [s[3], s[2]]);
  dayHiLayer.clearLayers();
  L.polyline(seg, { pane: 'dayhi', color: '#ffd54f', weight: 16, opacity: 0.85, interactive: false }).addTo(dayHiLayer);
  showView('map');
  map.fitBounds(L.latLngBounds(seg), { padding: [40, 40] });
  toast(`Tag ${n}: ${d.title}`);
}

// ---------- offline / settings ----------
function tileUrl(key, [z, x, y]) { return TILE_SOURCES[key].url.replace('{z}', z).replace('{x}', x).replace('{y}', y); }
function tileSets() {
  const along = (route) => prof[route].map((s) => [s[2], s[3]]);
  const pts = [...along('GR132'), ...along('GR131'), ...along('ALT')];
  const base = [];
  for (let z = 9; z <= 14; z++) base.push(...G.tilesInBBox(z, ISLAND_BBOX));
  base.push(...G.tilesAlong(15, pts, 1500), ...G.tilesAlong(16, pts, 600));
  const detail = G.tilesAlong(17, pts, 250);
  return { base, detail };
}
let dl = null;
async function downloadTiles(list, label) {
  if (dl) return;
  if (!('caches' in window)) { toast('Dieser Browser unterstützt keinen Offline-Speicher (Cache API). Bitte Chrome verwenden und über https/localhost öffnen.', 6000); return; }
  if (navigator.storage?.persist) await navigator.storage.persist();
  const cache = await caches.open(TILE_CACHE);
  dl = { ctrl: new AbortController(), done: 0, failed: 0, skipped: 0, total: list.length, label };
  renderSettings();
  let i = 0;
  const worker = async () => {
    while (i < list.length && !dl.ctrl.signal.aborted) {
      const url = tileUrl('topo', list[i++]);
      try {
        if (await cache.match(url)) dl.skipped++;
        else {
          const res = await fetch(url, { signal: dl.ctrl.signal, mode: 'cors' });
          if (res.ok) await cache.put(url, res); else dl.failed++;
        }
      } catch (e) { if (dl.ctrl.signal.aborted) break; dl.failed++; }
      dl.done++;
      if (dl.done % 10 === 0 || dl.done === dl.total) updateDlUi();
    }
  };
  // 3 parallel requests – polite to the volunteer-run OpenTopoMap servers
  await Promise.all([worker(), worker(), worker()]);
  const aborted = dl.ctrl.signal.aborted;
  const msg = aborted ? 'Download abgebrochen' : `${label}: fertig. ${dl.total - dl.failed} Kacheln offline verfügbar${dl.failed ? `, ${dl.failed} fehlgeschlagen (nochmal starten)` : ''}.`;
  dl = null;
  toast(msg, 5000);
  store.set('tilesDone-' + label, !aborted);
  renderSettings();
}
function updateDlUi() {
  const bar = $('#dl-bar'), txt = $('#dl-text');
  if (!dl || !bar) return;
  bar.style.width = `${(dl.done / dl.total) * 100}%`;
  txt.textContent = `${dl.label}: ${dl.done} / ${dl.total} Kacheln (${dl.skipped} schon da${dl.failed ? `, ${dl.failed} Fehler` : ''})`;
}
async function storageInfo() {
  let s = '';
  try {
    const est = await navigator.storage.estimate();
    s += `Belegt: ${(est.usage / 1e6).toFixed(0)} MB von ca. ${(est.quota / 1e9).toFixed(1)} GB verfügbar. `;
    const persisted = await navigator.storage.persisted?.();
    s += persisted ? 'Speicher ist dauerhaft (wird nicht automatisch gelöscht).' : 'Speicher nicht als dauerhaft markiert. Die App installieren (zum Startbildschirm) hilft.';
    const c = await caches.open(TILE_CACHE);
    s = `${(await c.keys()).length} Kartenkacheln gespeichert. ` + s;
  } catch { s = 'Speicherinfo nicht verfügbar.'; }
  return s;
}
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
async function renderSettings() {
  const el = $('#panel-settings');
  const sets = tileSets();
  const swOk = !!navigator.serviceWorker?.controller;
  el.innerHTML = `<h2>⚙️ Offline & Einstellungen</h2>
  <div class="card"><h3 style="margin-top:0">1. App offline verfügbar</h3>
    <p class="muted">${swOk ? '✅ Die App selbst, Routen, POIs und der Plan sind offline gespeichert.' : '⏳ Offline-Modus noch nicht aktiv. Seite einmal neu laden (Voraussetzung: https oder localhost).'}</p>
    <p class="muted">Daten-Stand: ${esc(new Date(D.poisMeta.generated).toLocaleString('de-DE'))}</p>
    ${installEvt ? '<button class="btn primary" id="btn-install">📲 Als App installieren</button>' : '<p class="muted">Tipp: In Chrome ⋮ → „Zum Startbildschirm hinzufügen“ bzw. „App installieren“.</p>'}
  </div>
  <div class="card"><h3 style="margin-top:0">2. Karte offline speichern (vor der Abreise im WLAN!)</h3>
    <p class="muted">Lädt OpenTopoMap-Kacheln: die ganze Insel bis Zoom 14, entlang aller Routen Zoom 15–16 (±1,5 km / ±600 m) und optional Zoom 17 (±250 m).</p>
    <div class="actions">
      <button class="btn primary" id="dl-base" ${dl ? 'disabled' : ''}>⬇️ Basis + Routen (${sets.base.length} Kacheln, ~${Math.round(sets.base.length * 0.025)} MB)</button>
      <button class="btn" id="dl-detail" ${dl ? 'disabled' : ''}>⬇️ Detail Zoom 17 (${sets.detail.length} Kacheln, ~${Math.round(sets.detail.length * 0.03)} MB)</button>
    </div>
    <div class="progress"><div id="dl-bar"></div></div>
    <div class="muted" id="dl-text">${dl ? '' : store.get('tilesDone-Basis', false) ? '✅ Basis gespeichert.' : 'Noch nichts geladen.'} ${store.get('tilesDone-Detail', false) ? '✅ Detail gespeichert.' : ''}</div>
    ${dl ? '<div class="actions"><button class="btn danger" id="dl-cancel">Abbrechen</button></div>' : ''}
    <p class="muted" id="storage">…</p>
    <div class="actions"><button class="btn danger" id="dl-clear">Kartenkacheln löschen</button></div>
    <p class="muted">Auch beim normalen Herumscrollen werden angesehene Kacheln automatisch gespeichert. Ohne Netz bleiben nicht gespeicherte Bereiche leer, Routen und Marker sind trotzdem da.</p>
  </div>
  <div class="card"><h3 style="margin-top:0">Kartenstil</h3>
    ${Object.entries(TILE_SOURCES).map(([k, s]) => `<label><input type="radio" name="tiles" value="${k}" ${state.tiles === k ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}
  </div>
  <div class="card"><h3 style="margin-top:0">Startdatum der Tour</h3>
    <label>Tag 1 = <input type="date" id="start-date" value="${(state.startDate || D.plan.start_date)}"></label>
    <p class="muted">Steuert die Wochentage im 8-Tage-Plan (Sonntag/Feiertag: viele Läden zu, 8.12. ist Feiertag).</p>
  </div>
  <div class="card"><h3 style="margin-top:0">Legende</h3>
    ${Object.values(CATS).map((c) => `<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><span class="poi-icon" style="background:${c.color};width:26px;height:26px">${c.icon}</span>${c.label}</div>`).join('')}
    <p class="muted">Gelbes „T3“ = Nachtlager von Tag 3. Gestrichelter Rand = Position nur ungefähr. Graue Wasserstelle = defekt. Hellblau = Qualität unsicher. Rot gestrichelte Fläche = Nationalpark Garajonay (Zelten verboten), orange = andere Schutzgebiete. Pfeile = Laufrichtung. Lange auf die Karte drücken = Punkt prüfen bzw. eigenen Punkt speichern.</p>
  </div>
  <div class="card"><h3 style="margin-top:0">Quellen & Lizenzen</h3>
    <p class="muted">Routen und POIs: © OpenStreetMap-Mitwirkende (ODbL). Höhen: Copernicus DEM GLO-90 (via Open-Meteo). Schutzgebiete: GRAFCAN / Gobierno de Canarias. Karte: OpenTopoMap (CC-BY-SA). Wildcamp-Spots, Öffnungszeiten, Wasser-Hinweise: Recherche aus Wanderberichten (Quellen je Eintrag). Alle Angaben ohne Gewähr. Öffnungszeiten ändern sich, im Zweifel vor Ort fragen.</p>
  </div>`;
  $('#dl-base').onclick = () => downloadTiles(sets.base, 'Basis');
  $('#dl-detail').onclick = () => downloadTiles(sets.detail, 'Detail');
  if ($('#dl-cancel')) $('#dl-cancel').onclick = () => dl?.ctrl.abort();
  $('#dl-clear').onclick = async (e) => { if (confirmTap(e.currentTarget, 'Wirklich alle Kacheln löschen? Nochmal tippen')) { await caches.delete(TILE_CACHE); store.set('tilesDone-Basis', false); store.set('tilesDone-Detail', false); renderSettings(); } };
  if ($('#btn-install')) $('#btn-install').onclick = async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; renderSettings(); };
  for (const r of el.querySelectorAll('input[name=tiles]')) r.onchange = () => setTiles(r.value);
  $('#start-date').onchange = (e) => { state.startDate = e.target.value || null; store.set('startDate', state.startDate); toast('Startdatum gespeichert'); };
  updateDlUi();
  $('#storage').textContent = await storageInfo();
}

// ---------- service worker ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Neue Version geladen. App neu öffnen zum Aktualisieren.', 5000);
      });
    });
  }).catch((e) => console.warn('SW registration failed', e));
}

// ---------- boot ----------
(async function boot() {
  initMap();
  try {
    await loadData();
  } catch (e) {
    document.body.insertAdjacentHTML('beforeend', `<div class="toast">Daten konnten nicht geladen werden (${esc(e.message)}). Die App muss über einen Webserver geöffnet werden (nicht file://).</div>`);
    return;
  }
  drawProtected();
  drawRoutes();
  applyRouteVisibility();
  drawMarkers();
  renderChips();
  if (state.me) { drawMe(true); }
  updateStatus();
  setInterval(updateStatus, 60000);
  // re-attach GPS automatically if permission was granted before
  navigator.permissions?.query({ name: 'geolocation' }).then((p) => { if (p.state === 'granted') startGps(); }).catch(() => {});
  if (location.hash.startsWith('#poi=')) { const p = allPois().find((x) => x.id === location.hash.slice(5)); if (p) { flyTo(p); openPoi(p); } }
})();
