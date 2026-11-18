// Builds data/protected.geojson from the official Canary Islands ENP shapefile (GRAFCAN open data,
// https://opendata.sitcan.es/upload/medio-ambiente/eennpp.zip) – only La Gomera (codes "G-…").
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shapefile from 'shapefile';
import proj4 from 'proj4';
import simplify from '@turf/simplify';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const utm28 = '+proj=utm +zone=28 +datum=WGS84 +units=m +no_defs';
const toWgs = (c) => proj4(utm28, 'WGS84', c).map((v) => +v.toFixed(6));

const RULES = {
  'Parque Nacional': 'Zelten UND Biwakieren sind im Nationalpark ausdrücklich verboten und werden kontrolliert. Kein Feuer, Kocher nur in ausgewiesenen Áreas recreativas. Vor Einbruch der Dunkelheit den Park verlassen.',
  'Reserva Natural Integral': 'Strengste Schutzkategorie: Wege nicht verlassen, Zelten verboten.',
  'Reserva Natural Especial': 'Zelten außerhalb genehmigter Zonen verboten (Ley 4/2017 Canarias, Orden 31.08.1993).',
  'Parque Natural': 'Zelten außerhalb genehmigter Zonen verboten. Von Wanderern berichtet: diskretes Übernachten (spät aufbauen, früh abbauen) wurde meist toleriert, Garantie gibt es keine.',
  'Parque Rural': 'Zelten außerhalb genehmigter Zonen verboten. Laut Berichten wird im Tal von Valle Gran Rey (Strände, Höhlen) gelegentlich geräumt.',
  'Monumento Natural': 'Zelten außerhalb genehmigter Zonen verboten.',
  'Paisaje Protegido': 'Zelten außerhalb genehmigter Zonen verboten.',
  'Sitio de Interés Científico': 'Zelten verboten.',
};

const src = await shapefile.open(path.join(root, 'raw/eennpp/eennpp.shp'), path.join(root, 'raw/eennpp/eennpp.dbf'), { encoding: 'latin1' });
const features = [];
for (let r = await src.read(); !r.done; r = await src.read()) {
  const { categoria, nombre, codigo } = r.value.properties;
  if (!/^G-/.test(codigo)) continue;
  const g = r.value.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const geometry = { type: 'MultiPolygon', coordinates: polys.map((poly) => poly.map((ring) => ring.map(toWgs))) };
  const f = simplify({ type: 'Feature', properties: {}, geometry }, { tolerance: 0.00008, highQuality: true });
  f.properties = {
    name: `${categoria} ${nombre}`, category: categoria, code: codigo,
    national_park: categoria === 'Parque Nacional',
    rule: RULES[categoria] || 'Zelten außerhalb genehmigter Zonen verboten.',
  };
  features.push(f);
}
features.sort((a, b) => Number(b.properties.national_park) - Number(a.properties.national_park));
await fs.writeFile(path.join(root, 'data/protected.geojson'), JSON.stringify({
  type: 'FeatureCollection',
  attribution: 'Espacios Naturales Protegidos de Canarias © GRAFCAN / Gobierno de Canarias (opendata.sitcan.es)',
  features,
}));
console.log(features.map((f) => `${f.properties.code} ${f.properties.name}`).join('\n'));
