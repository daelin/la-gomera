#!/usr/bin/env bash
# Fetches raw OpenStreetMap data for La Gomera via the Overpass API (with retries + mirror fallback).
# Usage: scripts/fetch-osm.sh [routes|pois|protected|all]
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p raw
BBOX="27.95,-17.40,28.25,-17.05"
ENDPOINTS=(https://overpass-api.de/api/interpreter https://overpass.private.coffee/api/interpreter https://overpass.kumi.systems/api/interpreter)

fetch() { # $1 = output file, $2 = query
  local wait=5
  for attempt in 1 2 3 4 5 6; do
    for ep in "${ENDPOINTS[@]}"; do
      if curl -sf -m 240 -A "la-gomera-trek-app/1.0" "$ep" --data-urlencode "data=$2" -o "$1.tmp" \
        && head -c 2000 "$1.tmp" | grep -q '"elements"' && ! grep -q '"remark": "runtime error' "$1.tmp"; then
        mv "$1.tmp" "$1"; echo "ok: $1 ($ep)"; return 0
      fi
      echo "retry $1 via next endpoint ($ep failed)" >&2
    done
    sleep $wait; wait=$((wait * 2))
  done
  rm -f "$1.tmp"; echo "FAILED: $1" >&2; return 1
}

ROUTES="[out:json][timeout:200];rel[\"route\"~\"hiking|foot\"][\"ref\"~\"^GR ?13[12]\$\"]($BBOX);out geom;"
POIS="[out:json][timeout:200];
(
 nwr[\"amenity\"~\"^(drinking_water|water_point|fountain|restaurant|cafe|fast_food|bar|pub|ice_cream|pharmacy|atm|shelter|ferry_terminal|bus_station|toilets|shower|fuel)\$\"]($BBOX);
 nwr[\"natural\"=\"spring\"]($BBOX);
 nwr[\"man_made\"~\"^(water_tap|water_well)\$\"]($BBOX);
 nwr[\"shop\"~\"^(supermarket|convenience|general|bakery|greengrocer|butcher|deli|kiosk|outdoor|sports|pastry|farm)\$\"]($BBOX);
 nwr[\"tourism\"~\"^(camp_site|picnic_site|alpine_hut|wilderness_hut)\$\"]($BBOX);
 nwr[\"drinking_water\"=\"yes\"]($BBOX);
 nwr[\"highway\"=\"bus_stop\"]($BBOX);
 node[\"place\"~\"^(town|village|hamlet|locality)\$\"]($BBOX);
 node[\"natural\"~\"^(beach|peak|saddle)\$\"]($BBOX);
 nwr[\"natural\"=\"beach\"]($BBOX);
 nwr[\"historic\"~\"^(ruins|building)\$\"]($BBOX);
 nwr[\"building\"=\"chapel\"]($BBOX);
 nwr[\"amenity\"=\"place_of_worship\"]($BBOX);
 nwr[\"tourism\"=\"viewpoint\"]($BBOX);
);
out center tags;"
PROTECTED="[out:json][timeout:200];(way[\"boundary\"~\"^(protected_area|national_park)\$\"]($BBOX);way[\"leisure\"=\"nature_reserve\"]($BBOX);rel[\"boundary\"~\"^(protected_area|national_park)\$\"]($BBOX);rel[\"leisure\"=\"nature_reserve\"]($BBOX););out geom;"

what="${1:-all}"
[[ $what == routes || $what == all ]] && fetch raw/routes.json "$ROUTES"
[[ $what == pois || $what == all ]] && fetch raw/pois.json "$POIS"
[[ $what == protected || $what == all ]] && fetch raw/protected.json "$PROTECTED"
if [[ $what == protected || $what == all ]]; then
  # official protected areas (Espacios Naturales Protegidos de Canarias, GRAFCAN)
  curl -sf -m 300 -o raw/eennpp.zip https://opendata.sitcan.es/upload/medio-ambiente/eennpp.zip && unzip -o -q raw/eennpp.zip -d raw/eennpp && echo "ok: raw/eennpp"
fi
exit 0
