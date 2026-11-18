# Gomera Trek – Offline-Wanderkarte La Gomera (GR 131 & GR 132)

Mobile-first Progressive Web App (PWA) für eine Zelt-Tour auf La Gomera. Die App zeigt:

- **Routen** aus echten OpenStreetMap-Relationen:
  - GR 131 von der Playa de Vallehermoso nach San Sebastián, ca. 43,6 km und ca. 2.150 Hm.
  - GR 132 komplett gegen den Uhrzeigersinn in den 8 offiziellen Etappen. Start und Ziel ist San Sebastián, ca. 128 km und ca. 7.150 Hm.
  - Die GR-132-Inlandsvariante über Vallehermoso.

  Dazu gibt es Laufrichtungspfeile, Kilometermarken und Höhenprofile.
- **Wildcamping-Spots** (26) aus realen Wanderberichten mit Untergrund, Wind- und Sichtschutz, Wasser, Schutzgebietsstatus und Quellen. Dazu kommen **offizielle Plätze** (Camping La Vista El Cedro und die Zone Playa de Ávalos).
- **Wasser** (45 Stellen) aus OSM und Berichten, jeweils mit Einschätzung der Verlässlichkeit. Defekte Hähne sind markiert.
- **Supermärkte/Tiendas, Imbisse/Cafés, Restaurants** mit Öffnungszeiten (Stand Nov. 2026). Die App zeigt live „jetzt offen“, „offen bei Ankunft“ und die Zeiten für den jeweiligen Plantag.
- **Schutzgebiete** aus der amtlichen Karte (GRAFCAN), z. B. der Nationalpark Garajonay, in dem Zelten verboten ist.
- **8-Tage-Plan** (erst GR 131, dann GR 132) mit Nachtlager für jeden Abend sowie Essens- und Wasserstrategie.
- **GPX pro Tag** mit Track (inkl. Höhen) und allen POIs am Weg als Wegpunkte, zum Öffnen in Komoot, OsmAnd usw.
- **GPS** mit Genauigkeitskreis, Folgemodus, Track-Kilometer, Warnung in Schutzgebieten und Sonnenuntergang. „⏭ Was kommt als Nächstes?“ zeigt das nächste Wasser, den nächsten Laden, das nächste Essen und das nächste Camp in Laufrichtung, jeweils mit km, Höhenmetern und Ankunftszeit.
- **Liste und Suche**, sortiert nach Routen-km, Entfernung oder „voraus ab meiner Position“.
- **Eigene Punkte:** Lange auf die Karte drücken.

## Auf dem Android-Handy starten

Service Worker (Offline-Modus) und GPS funktionieren im Browser nur über **HTTPS** oder **localhost**. Eine Datei per `file://` zu öffnen reicht nicht.

### Variante A (empfohlen): Über HTTPS hosten, z. B. GitHub Pages

1. Den Ordner als GitHub-Repo veröffentlichen und unter *Settings → Pages* die Option „Deploy from branch“ (`main`, `/root`) aktivieren.
2. Die Pages-URL auf dem Handy in **Chrome** öffnen und *⋮ → App installieren* bzw. *Zum Startbildschirm hinzufügen* wählen.

### Variante B: Lokal per Termux auf dem Handy

1. [Termux](https://f-droid.org/packages/com.termux/) installieren (aus F-Droid) und den Projektordner aufs Handy kopieren, z. B. nach `Download/la-gomera`.
2. In Termux:
   ```sh
   termux-setup-storage
   pkg install python
   cd ~/storage/downloads/la-gomera
   python -m http.server 8080
   ```
3. In Chrome `http://localhost:8080` öffnen und die App installieren.

Nach dem ersten Laden kommt die App aus dem Offline-Cache. Termux wird danach nur noch für Updates gebraucht.

### Variante C: Vom Mac per USB (Chrome Port-Forwarding)

1. Auf dem Mac `npm run serve` ausführen (Port 8080).
2. Auf dem Handy USB-Debugging aktivieren.
3. In Chrome am Mac `chrome://inspect` öffnen, *Port forwarding* `8080 → localhost:8080` einrichten und auf dem Handy `http://localhost:8080` öffnen.

## Vor der Abreise (im WLAN!)

1. App öffnen und unten **⚙️ Offline** antippen.
2. **„Basis + Routen“** laden: ca. 1.500 Kacheln, ~40 MB. Das ist die ganze Insel bis Zoom 14 plus der Korridor entlang aller Routen in Zoom 15–16.
3. Optional **„Detail Zoom 17“** laden: ca. 1.700 Kacheln, ~50 MB, ±250 m entlang der Routen.
4. Die App **installieren** (Startbildschirm). Dann markiert Chrome den Speicher als dauerhaft.
5. Kurz prüfen: Flugmodus an, App öffnen, Karte, Marker und Plan müssen da sein.
6. GPX-Dateien vorab in Komoot bzw. OsmAnd importieren und dort die Offline-Karte von La Gomera herunterladen.
7. Einmal auf 📍 tippen und den Standortzugriff erlauben.
8. Unter ⚙️ das **Startdatum** prüfen (voreingestellt So 22.11.2026). Davon hängen die Wochentage und Öffnungszeiten im Plan ab.

## 8-Tage-Plan: GR 131 + GR 132 (gegen den Uhrzeigersinn)

Früh morgens Start an der Playa de Vallehermoso, über den GR 131 nach San Sebastián und dann den kompletten GR 132 gegen den Uhrzeigersinn zurück nach San Sebastián. Am letzten Tag Ankunft spätestens 19:00. Insgesamt sind das ~172 km und ~9.300 Hm.

| Tag | Datum | Route | Etappe | Strecke | Hm | Gehzeit (DIN) | Nachtlager |
|---|---|---|---|---|---|---|---|
| 1 | So 22.11. | GR 131 | Playa de Vallehermoso → Vallehermoso → Las Hayas → Chipude → Pavón | 18,9 km | ↑1437 ↓431 | 8,0 h | Pavón, vor der Nationalparkgrenze |
| 2 | Mo 23.11. | GR 131 | Pavón → Igualero → Garajonay → Degollada de Peraza → San Sebastián | 24,7 km | ↑724 ↓1774 | 9,2 h | San Sebastián: Pension, Großeinkauf |
| 3 | Di 24.11. | GR 132 | San Sebastián → Jaragán → Enchereda → Majona → Playa de la Caleta | 23,9 km | ↑1148 ↓1085 | 9,0 h | Playa de la Caleta (Wasser, Duschen) |
| 4 | Mi 25.11. | GR 132 | Caleta → Hermigua → Agulo → Juego de Bolas → Playa de Vallehermoso → Rücken | 19,4 km | ↑1570 ↓1117 | 9,9 h | Felsrücken über der Playa de Vallehermoso |
| 5 | Do 26.11. | GR 132 | Rücken → Santa Clara → Epina → Alojera → Arure → Lomo del Carretón | 19,3 km | ↑1260 ↓993 | 8,6 h | Lomo del Carretón (Vorschlag, ohne Berichte) |
| 6 | Fr 27.11. | GR 132 | Lomo del Carretón → Valle Gran Rey → Gerián → Playa de Iguala | 17,4 km | ↑842 ↓1585 | 8,2 h | Playa de Iguala (Steinkreise) |
| 7 | Sa 28.11. | GR 132 | Iguala → La Dama → Arguayoda → Alajeró → Altamache | 24,6 km | ↑1354 ↓1063 | 9,7 h | Ruinen bei Altamache (Vorschlag, ohne Berichte) |
| 8 | So 29.11. | GR 132 | Altamache → Playa de Santiago → El Cabrito → San Sebastián | 24,0 km | ↑983 ↓1299 | 8,9 h | Ziel um ca. 17:30 (Deadline 19:00) |

- **Aufteilung:** Sie ist rechnerisch optimiert, bei möglichst gleich langen Tagen und möglichst nur berichteten Camp-Spots. Das rechnerische Minimum für den längsten Tag liegt bei ~9,5 h.
- **Gehzeit:** Angegeben ist die reine Gehzeit nach DIN 33466, ohne Pausen.
- **Tageslicht:** Ende November gibt es nur ~10,5 h Tageslicht (07:35–18:15). Jeden Tag mit dem ersten Licht starten.
- **Nacht 2:** Du übernachtest in San Sebastián. Es gibt dort keine sinnvolle Zeltstelle, dafür gibt es am Montag den Großeinkauf und Gaskartuschen.
- **Großeinkäufe:**
  - Vallehermoso (Tag 1, Sonntag: Suma/SPAR)
  - San Sebastián (Tag 2)
  - Agulo (Tag 4)
  - Valle Gran Rey (Tag 6)
  - Alajeró (Tag 7)
  - Playa de Santiago (Tag 8, Sonntag: Tagoror)
- **Wasser:**
  - San Sebastián → Caleta: ca. 24 km ohne Wasser, 5 l tragen.
  - Agulo → Santa Clara: ca. 15 km ohne verlässliches Wasser. Der Hahn an der Playa de Vallehermoso ist laut OSM defekt.
  - Valle Gran Rey → La Dama: der trockenste Abschnitt.
- **Ausweichoptionen** stehen in der App bei jedem Tag.

Details stehen in der App unter **🥾 8 Tage**.

## GPX-Dateien (Komoot & Co.)

Im Ordner [`gpx/`](gpx/) liegt **für jeden Tag eine GPX-Datei**, dazu `GomeraTrek_Gesamttour_GR131-GR132.gpx` mit allen 8 Tagen als einzelnen Tracks. Jede Tagesdatei enthält:

- den **Track** in voller OSM-Auflösung mit Höhen,
- alle **POIs am Weg als Wegpunkte**, sortiert in Laufrichtung: Nachtlager (`Camp T5: …`), Ausweich-Camps, Wasser (inkl. defekter Hähne), Läden, Cafés und Restaurants. Die Beschreibungen enthalten Öffnungszeiten, Verlässlichkeit, km und Schutzgebietsstatus.

**In der App:** Unter 🥾 8 Tage gibt es bei jedem Tag einen „📥 GPX“-Download (auch offline verfügbar). Die heruntergeladene Datei öffnest du dann mit Komoot, OsmAnd usw.

- **Komoot:** Komoot übernimmt den Track (Datei mit Komoot öffnen oder Planen → GPX importieren), aber **keine Wegpunkte**. Die POIs stehen in dieser App.
- **OsmAnd, Organic Maps, Locus, Gaia GPS, Garmin:** Diese Apps übernehmen Track **und** Wegpunkte.

## Projektstruktur

```
index.html, css/, js/          App (Leaflet lokal unter vendor/, keine CDN-Abhängigkeit)
sw.js, manifest.webmanifest    PWA / Offline-Cache (bei Änderungen VERSION in sw.js erhöhen!)
data/routes.geojson            GR 131 / GR 132 inkl. Höhenprofil (50-m-Raster)
data/pois.json                 alle POIs inkl. Track-km, Abstand zum Weg, Schutzgebiet
data/plan.json                 8-Tage-Plan mit berechneten Kennzahlen
data/protected.geojson         Schutzgebiete La Gomera (GRAFCAN)
gpx/                           GPX je Tag + Gesamttour (scripts/build-gpx.mjs), manifest.json
sources/                       kuratierte Recherche (Wildcamp, Wasser, Läden/Öffnungszeiten, Plan)
scripts/                       Datenbeschaffung & Build
raw/                           Rohdaten (Overpass, Recherche-Berichte, Höhen-Cache)
```

## Daten aktualisieren

```sh
npm install
npm run fetch:osm      # Overpass: Routen, POIs, Schutzgebiete (mit Retry/Mirror)
npm run build          # routes.geojson (+Höhen via Open-Meteo), protected.geojson, pois.json, plan.json, gpx/
npm test               # Unit-Tests der Öffnungszeiten-Logik
```

Die Schutzgebiete stammen aus `raw/eennpp/` und werden über `https://opendata.sitcan.es/upload/medio-ambiente/eennpp.zip` geladen.

## Quellen & Lizenzen

- Routen & POIs: © OpenStreetMap-Mitwirkende (ODbL)
- Höhen: Copernicus DEM GLO-90 via Open-Meteo
- Schutzgebiete: GRAFCAN / Gobierno de Canarias
- Karte: OpenTopoMap (CC-BY-SA)
- Wildcamp- und Wasserhinweise: Wanderberichte, die Quellen stehen bei jedem Eintrag, u. a. outdoorswithmax.com, juliantramper.nl, carohatwanderlust, findpenguins (Alex & Franzi), r/Ultralight, der-eskapist.de, guiaislascanarias.com.
- Leaflet 1.9.4 (BSD-2)

Bitte den Kachel-Download nur einmal ausführen. OpenTopoMap wird ehrenamtlich betrieben.
# la-gomera
