# Universe Monitor

**Live global intelligence, free forever.** One screen for the whole planet: earthquakes, natural events, unrest signals, world news, markets, crypto and FX — no sign-in, no paywall.

Built and maintained by [AI Humane Technologies](https://aihumane.in). Universe Monitor is the public taste of Phase 3 of the [AI Humane master plan](https://aihumane.in/plan/): one reasoning engine over all unstructured data.

**Live at [app.aihumane.in](https://app.aihumane.in)**

## What it shows

| Panel | Source |
|---|---|
| Live planet map (3 layers) | USGS earthquakes · NASA EONET natural events · GDELT unrest signals |
| Global wire (4 themes) | GDELT DOC 2.0 |
| Market pulse | CoinGecko global stats + top assets |
| Crypto & FX | CoinGecko + Frankfurter (ECB reference rates) |
| Seismic — last 24h | USGS |
| Natural events — open now | NASA EONET |

All feeds are public, keyless APIs fetched client-side. Every panel degrades independently — a rate-limited feed shows a status note and recovers on its own cycle.

## Architecture

Three files, no framework, no build step:

- `index.html` — layout and panels
- `styles.css` — design system (dark, data-dense)
- `app.js` — data engine: per-module loaders, a rate-limit queue for GDELT (≥6.5s spacing), auto-refresh cycles (60s–30min per feed)

Map: [Leaflet](https://leafletjs.com) with CARTO dark basemap tiles (© OpenStreetMap contributors, © CARTO).

Deployed via GitHub Pages on every push to `main`.

## Provenance

This is an original work of AI Humane Technologies Pvt Ltd, written from scratch. Signals are indicative, minutes-delayed, and not advice.

## Local development

Any static server works:

```bash
npx http-server . -p 8144
```
