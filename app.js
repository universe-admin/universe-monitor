/* ═══════════════════════════════════════════════════════════════
   Universe Monitor — data engine
   Original work © AI Humane Technologies. All feeds are public,
   keyless APIs fetched client-side; every module degrades alone.
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ══════════ tiny utils ══════════ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* Per-module accounting. Modules refresh on independent timers, so a running
   total would compound every cycle instead of describing what is on screen.
   Each module reports its own latest count and health; the headline figures are
   derived from that registry. */
const MODULES = ['quakes', 'events', 'instability', 'news', 'markets', 'crypto', 'fx', 'space', 'venues'];
/* Computed on the device rather than fetched. They count as signals on screen
   but they cannot fail, so they stay out of the feed-health fraction. */
const LOCAL_MODULES = ['sessions'];
const state = { feeds: {}, lastRefresh: null };

function report(module, count, ok) {
  state.feeds[module] = { count: Number(count) || 0, ok: !!ok, at: Date.now() };
  renderStats();
}

function renderStats() {
  const live = MODULES.concat(LOCAL_MODULES).map((m) => state.feeds[m]).filter(Boolean);
  const signals = live.reduce((sum, f) => sum + (f.ok ? f.count : 0), 0);
  const healthy = MODULES.map((m) => state.feeds[m]).filter((f) => f && f.ok).length;
  const el = $('[data-stat-signals]');
  if (el) el.textContent = signals.toLocaleString();
  const st = $('[data-refresh-status]');
  if (st && live.length) {
    st.textContent = healthy === MODULES.length
      ? `live · ${healthy}/${MODULES.length} feeds`
      : `degraded · ${healthy}/${MODULES.length} feeds`;
  }
}

async function fetchJSON(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

const fmtTime = (d) =>
  new Date(d).toISOString().slice(11, 16) + 'Z';

const ago = (ts) => {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function setStatus(sel, ok, note) {
  const el = $(sel);
  if (el) el.textContent = ok ? `updated ${fmtTime(Date.now())} · ${note}` : `unavailable · ${note}`;
}

/* ══════════ UTC clock ══════════ */

setInterval(() => {
  $('[data-utc-clock]').textContent = new Date().toISOString().slice(11, 19) + ' UTC';
}, 1000);

/* ══════════ map ══════════ */

const map = L.map('map', {
  center: [22, 12],
  zoom: 2,
  minZoom: 2,
  worldCopyJump: true,
  zoomControl: true,
  attributionControl: true,
});

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  subdomains: 'abcd',
  maxZoom: 12,
}).addTo(map);

const layers = {
  quakes: L.layerGroup().addTo(map),
  events: L.layerGroup().addTo(map),
  unrest: L.layerGroup().addTo(map),
};

/* The globe renders the same signals as the flat map, so both read from one
   registry rather than each loader knowing about two renderers. */
const signals = { quakes: [], events: [], unrest: [] };
const layerOn = { quakes: true, events: true, unrest: true };

function setSignals(kind, points) {
  signals[kind] = points || [];
  syncGlobe();
}

$$('.chip[data-layer]').forEach((chip) => {
  chip.addEventListener('click', () => {
    const key = chip.dataset.layer;
    const on = chip.classList.toggle('is-on');
    layerOn[key] = on;
    if (on) map.addLayer(layers[key]);
    else map.removeLayer(layers[key]);
    syncGlobe();
  });
});

/* ══════════ 3D globe ══════════
   Same signals, wrapped onto a sphere. The flat map stays the default view;
   the globe is drawn on a 2D canvas, so there is no WebGL requirement and no
   3D library to ship. */

let globe = null;
let globeMode = false;

function syncGlobe() {
  if (!globe) return;
  const pts = [];
  Object.keys(signals).forEach((kind) => {
    if (!layerOn[kind]) return;
    signals[kind].forEach((p) => pts.push(p));
  });
  globe.setMarkers(pts);
}

function initGlobe() {
  const canvas = $('#globe');
  if (!canvas || !window.Globe) return;
  globe = window.Globe.create(canvas, {
    onSelect: (m) => {
      const el = $('[data-globe-readout]');
      if (!el) return;
      el.textContent = m ? m.label : 'Drag to spin · scroll to zoom · click a marker';
    },
  });
  fetch('assets/data/world.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('world geometry'))))
    .then((w) => globe.setWorld(w))
    .catch(() => {
      const el = $('[data-globe-readout]');
      if (el) el.textContent = 'Coastlines unavailable — signals still plotted.';
    });
  syncGlobe();
}

function setView(mode) {
  globeMode = mode === 'globe';
  const mapEl = $('#map'), globeWrap = $('[data-globe-wrap]');
  if (!mapEl || !globeWrap) return;
  mapEl.hidden = globeMode;
  globeWrap.hidden = !globeMode;
  $$('.chip[data-view]').forEach((c) => c.classList.toggle('is-on', (c.dataset.view === 'globe') === globeMode));
  if (globeMode) {
    if (!globe) initGlobe();
    if (globe) { globe.start(); syncGlobe(); }
  } else {
    if (globe) globe.stop();
    map.invalidateSize();
  }
}

$$('.chip[data-view]').forEach((chip) => {
  chip.addEventListener('click', () => setView(chip.dataset.view));
});
const spinChip = $('[data-globe-spin]');
if (spinChip) {
  spinChip.addEventListener('click', () => {
    if (!globe) return;
    const on = !globe.spinning;
    globe.setSpin(on);
    spinChip.classList.toggle('is-on', on);
    spinChip.textContent = on ? 'Spinning' : 'Paused';
  });
}

/* ══════════ module: earthquakes (USGS) ══════════ */

async function loadQuakes() {
  const listEl = $('[data-quake-list]');
  try {
    const data = await fetchJSON('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson');
    const feats = (data.features || []).filter((f) => f.properties.mag >= 2.5);
    layers.quakes.clearLayers();
    feats.forEach((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const mag = f.properties.mag ?? 0;
      L.circleMarker([lat, lon], {
        radius: Math.max(3, mag * 1.9),
        color: mag >= 5.5 ? '#f87171' : '#ffc05f',
        weight: 1,
        fillColor: mag >= 5.5 ? '#f87171' : '#ff8a1f',
        fillOpacity: 0.55,
      })
        .bindPopup(`<strong>M${mag.toFixed(1)}</strong> ${esc(f.properties.place || 'unknown')}<br>${ago(f.properties.time)}`)
        .addTo(layers.quakes);
    });

    setSignals('quakes', feats.map((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const mag = f.properties.mag ?? 0;
      return {
        lat, lon, r: Math.max(2.5, mag * 1.4),
        color: mag >= 5.5 ? '#f87171' : '#ff8a1f',
        label: `M${mag.toFixed(1)} · ${f.properties.place || 'unknown'} · ${ago(f.properties.time)}`,
      };
    }));

    const top = feats.slice().sort((a, b) => b.properties.mag - a.properties.mag).slice(0, 14);
    listEl.innerHTML = top
      .map(
        (f) => `<li>
          <span class="event-badge${f.properties.mag >= 5.5 ? ' hi' : ''}">M${f.properties.mag.toFixed(1)}</span>
          <span class="event-name">${esc((f.properties.place || 'unknown').replace(/^\d+\s?km\s[A-Z]+\sof\s/, ''))}</span>
          <span class="event-sub">${ago(f.properties.time)}</span>
        </li>`
      )
      .join('') || '<li class="placeholder">Quiet planet right now.</li>';

    report('quakes', feats.length, true);
    setStatus('[data-quake-status]', true, `${feats.length} events ≥ M2.5`);
    return feats.length;
  } catch (e) {
    listEl.innerHTML = '<li class="placeholder">Seismic feed unavailable.</li>';
    setSignals('quakes', []);
    report('quakes', 0, false);
    setStatus('[data-quake-status]', false, 'USGS unreachable');
    return 0;
  }
}

/* ══════════ module: natural events (NASA EONET) ══════════ */

const EONET_ICON = { wildfires: '🔥', severeStorms: '🌀', volcanoes: '🌋', seaLakeIce: '🧊', floods: '🌊' };

async function loadEvents() {
  const listEl = $('[data-event-list]');
  try {
    const data = await fetchJSON('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=60');
    const events = (data.events || []).filter((ev) => ev.geometry && ev.geometry.length);
    layers.events.clearLayers();
    events.forEach((ev) => {
      const g = ev.geometry[ev.geometry.length - 1];
      const coords = g.type === 'Point' ? [g.coordinates[1], g.coordinates[0]] : null;
      if (!coords) return;
      const cat = ev.categories?.[0];
      L.circleMarker(coords, {
        radius: 5,
        color: '#22d3ee',
        weight: 1,
        fillColor: '#22d3ee',
        fillOpacity: 0.5,
      })
        .bindPopup(`<strong>${esc(cat?.title || 'Event')}</strong> ${esc(ev.title)}<br>${esc((g.date || '').slice(0, 10))}`)
        .addTo(layers.events);
    });

    setSignals('events', events.map((ev) => {
      const g = ev.geometry[ev.geometry.length - 1];
      if (!g || g.type !== 'Point') return null;
      return {
        lat: g.coordinates[1], lon: g.coordinates[0], r: 3.5, color: '#22d3ee',
        label: `${ev.categories?.[0]?.title || 'Event'} · ${ev.title}`,
      };
    }).filter(Boolean));

    listEl.innerHTML = events
      .slice(0, 14)
      .map((ev) => {
        const cat = ev.categories?.[0];
        const icon = EONET_ICON[cat?.id] || '⚠️';
        return `<li>
          <span class="event-badge cat">${icon}</span>
          <span class="event-name">${esc(ev.title)}</span>
          <span class="event-sub">${esc(cat?.title || '')}</span>
        </li>`;
      })
      .join('') || '<li class="placeholder">No open events.</li>';

    report('events', events.length, true);
    setStatus('[data-event-status]', true, `${events.length} open events`);
    return events.length;
  } catch (e) {
    listEl.innerHTML = '<li class="placeholder">Satellite feed unavailable.</li>';
    setSignals('events', []);
    report('events', 0, false);
    setStatus('[data-event-status]', false, 'EONET unreachable');
    return 0;
  }
}

/* ══════════ GDELT shared queue ══════════
   GDELT enforces ~1 request / 5 seconds per IP and returns plain-text
   errors with 200/429 status. All GDELT calls go through this queue
   (6.5s spacing) and a body-is-JSON guard. */

let gdeltChain = Promise.resolve();
let gdeltLast = 0;

function gdeltFetch(url) {
  const run = async () => {
    const wait = Math.max(0, gdeltLast + 6500 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    gdeltLast = Date.now();
    const text = await fetchText(url, 35000);
    const body = text.trim();
    if (!body.startsWith('{') && !body.startsWith('[')) throw new Error('GDELT rate-limited');
    return JSON.parse(body);
  };
  const p = gdeltChain.then(run, run);
  gdeltChain = p.catch(() => {});
  return p;
}

/* ══════════ module: Country Instability Index (GDELT GEO) ══════════
   Three families of language — armed conflict, governance stress, civil
   unrest — geolocated to the places the coverage is *about*, then weighted
   and ranked per country. instability.js holds the scoring and its caveats;
   this half does the fetching and the drawing.

   GEO is used rather than the article list because the article list only
   carries the publisher's country: a London desk writing about Khartoum
   would score London. GEO reports the places mentioned instead. */

async function loadInstability() {
  const listEl = $('[data-instability-list]');
  const responses = [];

  for (const dimension of Instability.DIMENSIONS) {
    try {
      const q = encodeURIComponent(`${dimension.query} sourcelang:eng`);
      const geojson = await gdeltFetch(
        `https://api.gdeltproject.org/api/v2/geo/geo?query=${q}&format=GeoJSON&mode=PointData&timespan=1d`
      );
      responses.push({ dimension, geojson });
    } catch (e) {
      /* One dimension failing narrows the index; it does not void it. The
         footer says which dimensions actually made it in. */
    }
  }

  const { ranked, points, dimensions, mentions } = Instability.aggregate(responses);

  layers.unrest.clearLayers();
  points.forEach((p) => {
    L.circleMarker([p.lat, p.lon], {
      radius: Math.min(13, 3 + Math.log2(p.count + 1) * 1.9),
      color: p.color, weight: 1, fillColor: p.color, fillOpacity: 0.38,
    })
      .bindPopup(`<strong>${esc(p.place)}</strong>${p.count} mention${p.count > 1 ? 's' : ''} · ${esc(p.kind)} · 24h`)
      .addTo(layers.unrest);
  });
  setSignals('unrest', points.map((p) => ({
    lat: p.lat, lon: p.lon, color: p.color,
    r: Math.min(9, 2.5 + Math.log2(p.count + 1) * 1.3),
    label: `${p.place} · ${p.count} mention${p.count > 1 ? 's' : ''} · ${p.kind}`,
  })));

  if (!ranked.length) {
    if (listEl) listEl.innerHTML = '<li class="placeholder">Index unavailable — GDELT may be rate-limiting. It rebuilds on the next cycle.</li>';
    report('instability', 0, false);
    setStatus('[data-instability-status]', false, 'GDELT GEO unreachable');
    return 0;
  }

  if (listEl) {
    listEl.innerHTML = ranked.slice(0, 12).map((r) => {
      const parts = Instability.DIMENSIONS
        .filter((d) => r.parts[d.key])
        .map((d) => `<span class="ix-part" style="--c:${d.color}">${d.label.toLowerCase()} ${r.parts[d.key]}</span>`)
        .join('');
      return `<li class="ix-row">
        <span class="ix-rank">${r.index}</span>
        <span class="ix-body">
          <span class="ix-country">${esc(r.country)}</span>
          <span class="ix-bar"><i style="width:${Math.max(2, r.index)}%"></i></span>
          <span class="ix-parts">${parts}</span>
        </span>
      </li>`;
    }).join('');
  }

  lastIndex = ranked;
  report('instability', ranked.length, true);
  setStatus('[data-instability-status]', true,
    `${ranked.length} countries · ${mentions.toLocaleString()} geolocated mentions · ${dimensions.length}/3 dimensions · GDELT GEO`);
  return ranked.length;
}

/* ══════════ module: global wire (GDELT DOC) ══════════ */

/* Raw GDELT query strings. They are encoded once at call time — the previous
   mix of hand-written %20 and literal spaces produced inconsistent URLs. */
const NEWS_QUERIES = {
  geopolitics: '(geopolitics OR sanctions OR military OR diplomacy OR conflict)',
  markets: '("stock market" OR inflation OR "central bank" OR earnings)',
  energy: '("oil prices" OR OPEC OR "natural gas" OR "renewable energy")',
  ai: '("artificial intelligence" OR "AI model" OR semiconductor OR chips)',
};

let activeTheme = 'geopolitics';

async function loadNews() {
  const listEl = $('[data-news-list]');
  try {
    const q = encodeURIComponent(`${NEWS_QUERIES[activeTheme]} sourcelang:eng`);
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&maxrecords=25&format=json&timespan=12h&sort=datedesc`;
    const data = await gdeltFetch(url);
    const arts = (data.articles || []).filter((a, i, arr) => arr.findIndex((b) => b.title === a.title) === i);
    listEl.innerHTML = arts
      .slice(0, 20)
      .map(
        (a) => `<li>
          <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>
          <span class="news-meta">${esc(a.domain || a.sourcecountry || '')} · ${esc(fmtGdeltDate(a.seendate))}</span>
        </li>`
      )
      .join('') || '<li class="placeholder">Wire is quiet.</li>';
    report('news', arts.length, true);
    lastWire = arts.slice(0, 12);
    setStatus('[data-news-status]', true, `${arts.length} stories · ${activeTheme}`);
  } catch (e) {
    listEl.innerHTML = '<li class="placeholder">Wire unavailable — GDELT may be rate-limiting. It recovers on the next cycle.</li>';
    report('news', 0, false);
    setStatus('[data-news-status]', false, 'GDELT unreachable');
  }
}

function fmtGdeltDate(s) {
  // seendate like 20260710T123000Z
  if (!s || s.length < 13) return '';
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:00Z`;
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? '' : ago(ts);
}

$$('.chip[data-theme]').forEach((chip) => {
  chip.addEventListener('click', () => {
    $$('.chip[data-theme]').forEach((c) => c.classList.remove('is-on'));
    chip.classList.add('is-on');
    activeTheme = chip.dataset.theme;
    $('[data-news-list]').innerHTML = '<li class="placeholder">Re-tuning the wire…</li>';
    loadNews();
  });
});

/* ══════════ module: market pulse (CoinGecko global + movers) ══════════ */

function quoteCard(name, px, chgPct, opts = {}) {
  const suffix = opts.suffix || '';
  const cls = chgPct > 0.001 ? 'up' : chgPct < -0.001 ? 'down' : 'flat';
  const sign = chgPct > 0 ? '+' : '';
  const chg = Number.isFinite(chgPct) ? `${sign}${chgPct.toFixed(2)}%` : '—';
  const pxStr = Number.isFinite(px)
    ? (opts.compact ? compactUsd(px) : px.toLocaleString(undefined, { maximumFractionDigits: opts.digits ?? (px < 10 ? 4 : 2) }) + suffix)
    : '—';
  return `<div class="quote">
    <span class="q-sym">${esc(name)}</span>
    <span class="q-px">${pxStr}</span>
    <span class="q-chg ${cls}">${chg}</span>
  </div>`;
}

function compactUsd(n) {
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  return '$' + n.toLocaleString();
}

async function loadMarkets() {
  const idxEl = $('[data-indices]');
  const comEl = $('[data-commodities]');
  try {
    const g = await fetchJSON('https://api.coingecko.com/api/v3/global');
    const d = g.data || {};
    idxEl.innerHTML = [
      quoteCard('Crypto mcap', d.total_market_cap?.usd ?? NaN, d.market_cap_change_percentage_24h_usd ?? NaN, { compact: true }),
      quoteCard('24h volume', d.total_volume?.usd ?? NaN, NaN, { compact: true }),
      quoteCard('BTC dominance', d.market_cap_percentage?.btc ?? NaN, NaN, { suffix: '%', digits: 1 }),
      quoteCard('Active coins', d.active_cryptocurrencies ?? NaN, NaN, { digits: 0 }),
    ].join('');

    const movers = await fetchJSON(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=8&page=1&price_change_percentage=24h'
    );
    comEl.innerHTML = movers
      .map((c) => quoteCard(c.symbol.toUpperCase(), c.current_price, c.price_change_percentage_24h))
      .join('');
    report('markets', 4 + movers.length, true);
    setStatus('[data-mkt-status]', true, `${movers.length} assets · 24h · CoinGecko`);
  } catch (e) {
    idxEl.innerHTML = '<div class="placeholder">Market pulse cooling down (rate limit) — retries shortly.</div>';
    comEl.innerHTML = '';
    report('markets', 0, false);
    setStatus('[data-mkt-status]', false, 'CoinGecko rate-limited');
  }
}

/* ══════════ module: trading venues (CoinGecko exchanges) ══════════
   Where the volume actually clears. Trust score is CoinGecko's own 1–10
   rating of a venue's reported volume, not ours. */

async function loadVenues() {
  const el = $('[data-venues]');
  if (!el) return 0;
  try {
    const list = await fetchJSON('https://api.coingecko.com/api/v3/exchanges?per_page=8&page=1');
    const rows = Array.isArray(list) ? list.slice(0, 8) : [];
    if (!rows.length) throw new Error('empty');
    el.innerHTML = rows.map((x) => {
      const btc = Number(x.trade_volume_24h_btc);
      const trust = Number(x.trust_score);
      const cls = trust >= 9 ? 'up' : trust >= 7 ? 'flat' : 'down';
      return `<div class="quote">
        <span class="q-sym">${esc(x.name || x.id || '—')}</span>
        <span class="q-px">${Number.isFinite(btc) ? btc.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' BTC' : '—'}</span>
        <span class="q-chg ${cls}">${Number.isFinite(trust) ? 'trust ' + trust + '/10' : '—'}</span>
      </div>`;
    }).join('');
    report('venues', rows.length, true);
    return rows.length;
  } catch (e) {
    el.innerHTML = '<div class="placeholder">Venue rankings cooling down (rate limit) — retries shortly.</div>';
    report('venues', 0, false);
    return 0;
  }
}

/* ══════════ module: world exchange sessions ══════════
   Computed from published trading hours and the browser's own timezone
   database — no feed, no key, and it survives every API being down.
   exchanges.js holds the table and the open/closed maths. */

function renderSessions() {
  const el = $('[data-sessions]');
  if (!el || !window.Exchanges) return 0;
  const rows = Exchanges.snapshot();
  const open = rows.filter((r) => r.open);

  el.innerHTML = rows.map((r) => `
    <div class="mkt ${r.open ? 'is-open' : ''}" title="${esc(r.ex.city)} · ${esc(r.hours)} local">
      <span class="mkt-dot" aria-hidden="true"></span>
      <span class="mkt-code">${esc(r.ex.code)}</span>
      <span class="mkt-city">${esc(r.ex.city)}</span>
      <span class="mkt-clock">${esc(r.localTime)}</span>
      <span class="mkt-next">${r.open ? 'closes' : 'opens'} in ${esc(Exchanges.countdown(r.next && r.next.in))}</span>
    </div>`).join('');

  const counter = $('[data-sessions-count]');
  if (counter) counter.textContent = `${open.length}/${rows.length} open`;
  report('sessions', rows.length, true);
  setStatus('[data-sessions-status]', true,
    `${open.length} of ${rows.length} trading now · local exchange hours · public holidays not modelled`);
  return rows.length;
}

/* ══════════ module: crypto (CoinGecko) + FX (Frankfurter) ══════════ */

const COINS = [
  { id: 'bitcoin', name: 'BTC' },
  { id: 'ethereum', name: 'ETH' },
  { id: 'solana', name: 'SOL' },
  { id: 'binancecoin', name: 'BNB' },
];

async function loadCrypto() {
  const el = $('[data-crypto]');
  try {
    const ids = COINS.map((c) => c.id).join(',');
    const data = await fetchJSON(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
    );
    el.innerHTML = COINS.map((c) => {
      const row = data[c.id];
      return quoteCard(c.name, row?.usd ?? NaN, row?.usd_24h_change ?? NaN);
    }).join('');
    report('crypto', COINS.length, true);
    setStatus('[data-money-status]', true, '24h change · CoinGecko + ECB');
  } catch (e) {
    el.innerHTML = '<div class="placeholder">Crypto feed cooling down (rate limit) — retries shortly.</div>';
    report('crypto', 0, false);
    setStatus('[data-money-status]', false, 'CoinGecko rate-limited');
  }
}

const FX = ['EUR', 'GBP', 'JPY', 'INR', 'CNY', 'CHF', 'CAD', 'AUD', 'BRL', 'ZAR', 'MXN', 'KRW'];

async function loadFX() {
  const el = $('[data-fx]');
  try {
    const data = await fetchJSON(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${FX.join(',')}`);
    el.innerHTML = FX.map((sym) => quoteCard(`USD/${sym}`, data.rates?.[sym] ?? NaN, NaN)).join('');
    report('fx', FX.length, true);
  } catch (e) {
    el.innerHTML = '<div class="placeholder">FX feed unavailable.</div>';
    report('fx', 0, false);
  }
}


/* ══════════ module: space weather (NOAA SWPC — keyless) ══════════
   Geomagnetic storms disrupt power grids, aviation routing and satellite
   links, so they belong next to the other planetary signals. */

const KP_LABEL = (kp) =>
  kp >= 7 ? ['Severe storm', 'hi'] : kp >= 5 ? ['Geomagnetic storm', 'hi']
  : kp >= 4 ? ['Unsettled', ''] : ['Quiet', ''];

async function loadSpace() {
  const el = $('[data-space]');
  if (!el) return 0;
  try {
    const kpSeries = await fetchJSON('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
    /* First row is a header; last row is the most recent 3-hour bin. */
    const rows = (kpSeries || []).slice(1).filter((r) => r && r.length >= 2);
    const latest = rows[rows.length - 1];
    const kp = parseFloat(latest?.[1]);
    const [label, hi] = KP_LABEL(kp);
    const peak = rows.slice(-8).reduce((m, r) => Math.max(m, parseFloat(r[1]) || 0), 0);

    el.innerHTML = [
      quoteCard('Kp index', kp, NaN, { digits: 1 }),
      quoteCard('Peak · 24h', peak, NaN, { digits: 1 }),
    ].join('') +
      `<div class="quote"><span class="q-sym">Condition</span>
        <span class="q-px"><span class="event-badge${hi ? ' hi' : ''}">${esc(label)}</span></span>
        <span class="q-chg flat">${esc((latest?.[0] || '').slice(0, 16))}Z</span></div>`;

    report('space', rows.length ? 3 : 0, true);
    setStatus('[data-space-status]', true, `Kp ${Number.isFinite(kp) ? kp.toFixed(1) : '—'} · NOAA SWPC`);
    return kp;
  } catch (e) {
    el.innerHTML = '<div class="placeholder">Space weather feed unavailable.</div>';
    report('space', 0, false);
    setStatus('[data-space-status]', false, 'NOAA SWPC unreachable');
    return 0;
  }
}

/* ══════════ module: AI brief (Groq, via the AI Humane gateway) ══════════
   Everything above is raw signal. This turns the current screen into a short
   situational read. The gateway holds the API key server-side — nothing
   sensitive ships to the browser. */

const GATEWAY = 'https://vctzpkkzmjwsoycgkzju.supabase.co/functions/v1/iva-gateway';
const GATEWAY_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjdHpwa2t6bWp3c295Y2dremp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MTgzNjQsImV4cCI6MjEwMDQ5NDM2NH0.GYjMn5JFhr9ISDAvd0lVfduROOJvnBbd2utPah6O4mU';
const BRIEF_MODEL = 'groq/openai/gpt-oss-120b';

let lastWire = [];
let lastIndex = [];
let briefAt = 0;

function briefFacts() {
  const f = state.feeds;
  const lines = [];
  if (f.quakes?.ok) lines.push(`Seismic: ${f.quakes.count} quakes at or above M2.5 in the last 24h.`);
  if (f.events?.ok) lines.push(`Natural events open now (NASA EONET): ${f.events.count}.`);
  if (f.instability?.ok && lastIndex.length) {
    lines.push('Countries by instability-signal index (relative, media-derived, 100 = highest today):');
    lastIndex.slice(0, 6).forEach((r) => lines.push(`- ${r.country}: ${r.index}`));
  }
  if (f.sessions?.ok) {
    const c = $('[data-sessions-count]')?.textContent;
    if (c) lines.push(`Exchange sessions: ${c}.`);
  }
  if (f.space?.ok) {
    const kp = $('[data-space] .q-px')?.textContent?.trim();
    if (kp) lines.push(`Geomagnetic Kp index: ${kp}.`);
  }
  if (lastWire.length) {
    lines.push('Recent headlines:');
    lastWire.slice(0, 10).forEach((a) => lines.push(`- ${a.title}`));
  }
  return lines.join('\n');
}

async function loadBrief() {
  const el = $('[data-brief]');
  if (!el) return;
  /* One synthesis per 10 minutes: the underlying feeds move slower than that,
     and it keeps model usage proportionate. */
  if (Date.now() - briefAt < 600000) return;
  const facts = briefFacts();
  if (!facts) return;
  briefAt = Date.now();

  el.innerHTML = '<p class="placeholder">Reading the board…</p>';
  try {
    const res = await fetch(GATEWAY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GATEWAY_KEY}`,
        apikey: GATEWAY_KEY,
      },
      body: JSON.stringify({
        model: BRIEF_MODEL,
        stream: false,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are a situational analyst. From the live readings below, write 3 short bullets on what is notable right now. ' +
              'Use only what you are given — do not invent numbers, places or events, and do not speculate about causes. ' +
              'If the readings are unremarkable, say so plainly. No preamble, no headings, under 70 words total.',
          },
          { role: 'user', content: facts },
        ],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('empty');

    const bullets = text.split(/\n+/).map((l) => l.replace(/^[-•*\d.\s]+/, '').trim()).filter(Boolean);
    el.innerHTML = `<ul class="brief-list">${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`;
    const tok = data?.usage?.total_tokens;
    setStatus('[data-brief-status]', true, `GPT-OSS 120B${tok ? ` · ${tok} tokens` : ''} — synthesis of the feeds above, not a separate source`);
  } catch (e) {
    el.innerHTML = '<p class="placeholder">Brief unavailable — the panels above are unaffected.</p>';
    setStatus('[data-brief-status]', false, 'synthesis offline');
  }
}

/* ══════════ orchestration ══════════ */

async function refreshAll() {
  $('[data-refresh-status]').textContent = 'refreshing…';
  /* Every loader catches its own error, so promise settlement says nothing
     about feed health — renderStats() reads the per-module registry instead. */
  renderSessions();
  await Promise.allSettled([
    loadQuakes(), loadEvents(), loadInstability(), loadNews(),
    loadMarkets(), loadVenues(), loadCrypto(), loadFX(), loadSpace(),
  ]);
  state.lastRefresh = Date.now();
  renderStats();
  $('[data-map-status]').textContent =
    'earthquakes ● amber · natural events ● cyan · conflict ● red · governance ● orange · unrest ● violet — click any marker';
  loadBrief();
}

refreshAll();
setInterval(renderSessions, 30000);      // a clock, so it ticks on its own
setInterval(loadCrypto, 120000);
setInterval(loadNews, 180000);
setInterval(() => { loadQuakes(); loadEvents(); }, 300000);
setInterval(loadMarkets, 300000);
setInterval(loadVenues, 600000);
setInterval(loadInstability, 1200000);   // 3 queued GDELT calls; it moves slowly
setInterval(loadFX, 1800000);
setInterval(loadSpace, 900000);
setInterval(loadBrief, 600000);
