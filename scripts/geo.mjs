const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

// haversine distance in meters between [lon, lat] points
export function dist(a, b) {
  const dLat = toRad(b[1] - a[1]), dLon = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// nearest point on a profile polyline ([d, ele, lon, lat] samples) → { d, ele, off }
export function nearestOnProfile(profile, p) {
  let best = null;
  for (const s of profile) {
    const off = dist([s[2], s[3]], p);
    if (!best || off < best.off) best = { d: s[0], ele: s[1], off };
  }
  return best;
}
