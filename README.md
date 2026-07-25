# Universe Monitor

**Live global intelligence, free forever.** One screen for the whole planet: earthquakes, natural events, unrest signals, world news, markets, crypto and FX — no sign-in, no paywall.

Built and maintained by [AI Humane Technologies](https://aihumane.in). Universe Monitor is the public taste of Phase 3 of the [AI Humane master plan](https://aihumane.in/plan/): one reasoning engine over all unstructured data.

**Live at [app.aihumane.in](https://app.aihumane.in)**

## What it shows

| Panel | Source |
|---|---|
| Live planet — flat map or 3D globe, 3 layers | USGS earthquakes · NASA EONET natural events · GDELT GEO instability signals |
| Instability index | GDELT GEO 2.0 (three weighted dimensions) |
| Global wire (4 themes) | GDELT DOC 2.0 |
| Market pulse + top venues | CoinGecko global stats, top assets and exchange rankings |
| Exchange floor | Computed on-device from published trading hours + the IANA timezone database |
| Crypto & FX | CoinGecko + Frankfurter (ECB reference rates, 12 pairs) |
| Seismic — last 24h | USGS |
| Natural events — open now | NASA EONET |
| Space weather | NOAA SWPC |

### The instability index, and what it does not mean

Coverage volume for armed conflict (×3), governance stress (×2) and civil
unrest (×1), geolocated by GDELT to the places the reporting is *about*, summed
per country and scaled so today's highest scorer is 100.

It measures reporting, not reality. English-language sources only; countries
with a large media footprint attract more coverage; one big story can dominate
a country for a day; and places with little press access under-report exactly
when a situation is worst. The score is relative to the current day and cannot
be compared across days.

### The exchange floor

Open/closed state for 20 exchanges from their published session times and the
browser's own timezone database, so daylight saving is always current. Public
holidays are **not** modelled — an exchange shown as open may be shut for one.
Times are the main continuous auction; pre-open and closing auctions excluded.

All feeds are public, keyless APIs fetched client-side. Every panel degrades independently — a rate-limited feed shows a status note and recovers on its own cycle.

## Architecture

No framework, no build step:

- `index.html` — layout and panels
- `styles.css` — design system (dark, data-dense)
- `app.js` — data engine: per-module loaders, a rate-limit queue for GDELT (≥6.5s spacing), auto-refresh cycles (30s–30min per feed)
- `globe.js` — orthographic globe on a 2D canvas
- `exchanges.js` — trading-hours table and the open/closed maths
- `instability.js` — index scoring, with its caveats stated in the source

Map: [Leaflet](https://leafletjs.com) with CARTO dark basemap tiles (© OpenStreetMap contributors, © CARTO).

Globe: no WebGL and no 3D library. Land is filled by inverse-projecting each
pixel into an equirectangular mask rasterised once from the coastline data —
polygon filling cannot close the two rings that circle the planet (Antarctica
around the pole, Afro-Eurasia across the antimeridian) without inverting the
fill. Coastlines and borders are stroked as vectors on top. The per-pixel
tables depend on the tilt but not the spin, so rotating is a lookup per pixel.

Coastlines: Natural Earth 1:110m (public domain) via
[world-atlas](https://github.com/topojson/world-atlas), ISC licence,
© 2012–2019 Michael Bostock.

Deployed via GitHub Pages on every push to `main`.

## Provenance

This is an original work of AI Humane Technologies Pvt Ltd, written from scratch. Signals are indicative, minutes-delayed, and not advice.

## Local development

Any static server works:

```bash
npx http-server . -p 8144
```
