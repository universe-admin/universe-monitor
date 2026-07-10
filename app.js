/* ═══════════════════════════════════════════════════════════════
   Universe Monitor — data engine
   Original work © AI Humane Technologies. All feeds are public,
   keyless APIs fetched client-side; every module degrades alone.
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ══════════ tiny utils ══════════ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = { signals: 0, lastRefresh: null };

function bumpSignals(n) {
  state.signals += n;
  $('[data-stat-signals]').textContent = state.signals.toLocaleString();
}

function resetSignals() {
  state.signals = 0;
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

$$('.chip[data-layer]').forEach((chip) => {
  chip.addEventListener('click', () => {
    const key = chip.dataset.layer;
    const on = chip.classList.toggle('is-on');
    if (on) map.addLayer(layers[key]);
    else map.removeLayer(layers[key]);
  });
});

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

    bumpSignals(feats.length);
    setStatus('[data-quake-status]', true, `${feats.length} events ≥ M2.5`);
    return feats.length;
  } catch (e) {
    listEl.innerHTML = '<li class="placeholder">Seismic feed unavailable.</li>';
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

    bumpSignals(events.length);
    setStatus('[data-event-status]', true, `${events.length} open events`);
    return events.length;
  } catch (e) {
    listEl.innerHTML = '<li class="placeholder">Satellite feed unavailable.</li>';
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

/* ══════════ module: unrest signals (GDELT DOC → country bubbles) ══════════ */

const CENTROIDS = {
  'united states': [39.8, -98.6], 'china': [35.9, 104.2], 'india': [21.0, 78.0], 'russia': [61.5, 96.7],
  'united kingdom': [54.0, -2.5], 'france': [46.6, 2.5], 'germany': [51.1, 10.4], 'brazil': [-10.8, -52.9],
  'japan': [36.6, 138.0], 'south korea': [36.4, 127.8], 'north korea': [40.3, 127.4], 'iran': [32.6, 54.3],
  'israel': [31.4, 35.0], 'ukraine': [48.9, 31.4], 'turkey': [39.0, 35.3], 'pakistan': [29.9, 69.4],
  'indonesia': [-2.2, 117.4], 'nigeria': [9.6, 8.1], 'egypt': [26.6, 29.8], 'south africa': [-29.0, 25.1],
  'mexico': [23.9, -102.5], 'argentina': [-35.4, -65.2], 'colombia': [3.9, -73.1], 'venezuela': [7.1, -66.2],
  'canada': [56.1, -106.3], 'australia': [-25.7, 134.5], 'spain': [40.2, -3.6], 'italy': [42.8, 12.1],
  'poland': [52.1, 19.4], 'netherlands': [52.2, 5.6], 'greece': [39.1, 22.9], 'sweden': [62.8, 16.7],
  'saudi arabia': [24.1, 44.5], 'iraq': [33.0, 43.8], 'syria': [35.0, 38.5], 'yemen': [15.9, 47.6],
  'afghanistan': [33.8, 66.0], 'bangladesh': [23.9, 90.2], 'myanmar': [21.2, 96.5], 'thailand': [15.1, 101.0],
  'philippines': [12.9, 122.9], 'vietnam': [16.6, 106.3], 'kenya': [0.5, 37.9], 'ethiopia': [8.6, 39.6],
  'sudan': [15.6, 30.3], 'congo': [-2.9, 23.6], 'somalia': [6.1, 45.9], 'libya': [27.0, 18.0],
  'georgia': [42.2, 43.5], 'serbia': [44.2, 20.8], 'belarus': [53.5, 28.0], 'kazakhstan': [48.2, 67.3],
  'peru': [-9.2, -74.4], 'chile': [-37.7, -71.4], 'bolivia': [-16.7, -64.7], 'haiti': [19.1, -72.7],
};

async function loadUnrest() {
  try {
    const data = await gdeltFetch(
      'https://api.gdeltproject.org/api/v2/doc/doc?query=(protest%20OR%20riot%20OR%20unrest)%20sourcelang:eng&mode=artlist&maxrecords=75&format=json&timespan=1d'
    );
    const byCountry = {};
    (data.articles || []).forEach((a) => {
      const c = String(a.sourcecountry || '').toLowerCase();
      if (CENTROIDS[c]) byCountry[c] = (byCountry[c] || 0) + 1;
    });
    layers.unrest.clearLayers();
    let n = 0;
    Object.entries(byCountry).forEach(([c, count]) => {
      n += count;
      L.circleMarker(CENTROIDS[c], {
        radius: Math.min(14, 4 + Math.log2(count + 1) * 2.4),
        color: '#6d5ae6',
        weight: 1,
        fillColor: '#6d5ae6',
        fillOpacity: 0.4,
      })
        .bindPopup(`<strong>${esc(c.replace(/\b\w/g, (m) => m.toUpperCase()))}</strong>${count} unrest-related stor${count > 1 ? 'ies' : 'y'} · 24h`)
        .addTo(layers.unrest);
    });
    bumpSignals(n);
    return n;
  } catch (e) {
    return 0;
  }
}

/* ══════════ module: global wire (GDELT DOC) ══════════ */

const NEWS_QUERIES = {
  geopolitics: '(geopolitics OR sanctions OR military OR diplomacy OR conflict)',
  markets: '(stock%20market OR inflation OR "central bank" OR earnings)',
  energy: '(oil%20prices OR OPEC OR "natural gas" OR renewable%20energy)',
  ai: '("artificial intelligence" OR AI%20model OR semiconductor OR chips)',
};

let activeTheme = 'geopolitics';

async function loadNews() {
  const listEl = $('[data-news-list]');
  try {
    const q = NEWS_QUERIES[activeTheme];
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}%20sourcelang:eng&mode=artlist&maxrecords=25&format=json&timespan=12h&sort=datedesc`;
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
    bumpSignals(arts.length);
    setStatus('[data-news-status]', true, `${arts.length} stories · ${activeTheme}`);
  } catch (e) {
    listEl.innerHTML = '<li class="placeholder">Wire unavailable — GDELT may be rate-limiting. It recovers on the next cycle.</li>';
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
  const cls = chgPct > 0.001 ? 'up' : chgPct < -0.001 ? 'down' : 'flat';
  const sign = chgPct > 0 ? '+' : '';
  const chg = Number.isFinite(chgPct) ? `${sign}${chgPct.toFixed(2)}%` : '—';
  const pxStr = Number.isFinite(px)
    ? (opts.compact ? compactUsd(px) : px.toLocaleString(undefined, { maximumFractionDigits: px < 10 ? 4 : 2 }))
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
      quoteCard('BTC dominance', d.market_cap_percentage?.btc ?? NaN, NaN),
      quoteCard('Active coins', d.active_cryptocurrencies ?? NaN, NaN),
    ].join('');

    const movers = await fetchJSON(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=8&page=1&price_change_percentage=24h'
    );
    comEl.innerHTML = movers
      .map((c) => quoteCard(c.symbol.toUpperCase(), c.current_price, c.price_change_percentage_24h))
      .join('');
    bumpSignals(4 + movers.length);
    setStatus('[data-mkt-status]', true, '24h · CoinGecko — equities & commodities land with the AI Humane edge relay');
  } catch (e) {
    idxEl.innerHTML = '<div class="placeholder">Market pulse cooling down (rate limit) — retries shortly.</div>';
    comEl.innerHTML = '';
    setStatus('[data-mkt-status]', false, 'CoinGecko rate-limited');
  }
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
    bumpSignals(COINS.length);
    setStatus('[data-money-status]', true, '24h change · CoinGecko + ECB');
  } catch (e) {
    el.innerHTML = '<div class="placeholder">Crypto feed cooling down (rate limit) — retries shortly.</div>';
    setStatus('[data-money-status]', false, 'CoinGecko rate-limited');
  }
}

const FX = ['EUR', 'GBP', 'JPY', 'INR', 'CNY', 'CHF'];

async function loadFX() {
  const el = $('[data-fx]');
  try {
    const data = await fetchJSON(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${FX.join(',')}`);
    el.innerHTML = FX.map((sym) => quoteCard(`USD/${sym}`, data.rates?.[sym] ?? NaN, NaN)).join('');
    bumpSignals(FX.length);
  } catch (e) {
    el.innerHTML = '<div class="placeholder">FX feed unavailable.</div>';
  }
}

/* ══════════ orchestration ══════════ */

async function refreshAll() {
  resetSignals();
  $('[data-refresh-status]').textContent = 'refreshing…';
  const results = await Promise.allSettled([
    loadQuakes(),
    loadEvents(),
    loadUnrest(),
    loadNews(),
    loadMarkets(),
    loadCrypto(),
    loadFX(),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  state.lastRefresh = Date.now();
  $('[data-refresh-status]').textContent = `live · ${ok}/7 feeds`;
  $('[data-map-status]').textContent =
    `earthquakes ● amber · natural events ● cyan · unrest ● violet — click any marker`;
}

refreshAll();
setInterval(loadCrypto, 120000);
setInterval(loadNews, 180000);
setInterval(() => { loadQuakes(); loadEvents(); loadUnrest(); }, 300000);
setInterval(loadMarkets, 300000);
setInterval(loadFX, 1800000);
