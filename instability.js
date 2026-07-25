/* ═══════════════════════════════════════════════════════════════
   Universe Monitor — Country Instability Index
   Original work © AI Humane Technologies.

   WHAT THIS MEASURES — read this before trusting a number.

   The index is built from GDELT's GEO API, which geolocates the places
   *mentioned* in global news coverage (not the country the publisher sits
   in). For three families of language — armed conflict, governance stress
   and civil unrest — it counts how much coverage in the last 24 hours
   mentions places inside each country, weights the three by severity, and
   scales the result against the highest-scoring country of the moment.

   So it is a measure of the volume of instability-related *reporting*
   attached to a country today. It is not a measure of how unstable a
   country is. Known biases, stated plainly:
     • English-language sources only.
     • Countries with a large media footprint attract more coverage.
     • A single large story can dominate a country's score for a day.
     • Places with little press access under-report — the score can fall
       precisely when a situation is at its worst.
     • 100 always belongs to the top country today; it is relative, not
       absolute, and cannot be compared across days.
   ═══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  /* Weighted by severity of what the language describes: shelling is not a
     protest. The weights are a judgement call, and they are the main knob a
     reader might disagree with — so they ship visible rather than buried. */
  const DIMENSIONS = [
    { key: 'conflict',   label: 'Armed conflict',   weight: 3, color: '#f87171',
      query: '("armed clash" OR airstrike OR shelling OR insurgency OR militants OR "armed group")' },
    { key: 'governance', label: 'Governance stress', weight: 2, color: '#ff8a1f',
      query: '(coup OR "state of emergency" OR "martial law" OR curfew OR "disputed election")' },
    { key: 'unrest',     label: 'Civil unrest',      weight: 1, color: '#6d5ae6',
      query: '(protest OR riot OR "general strike" OR crackdown)' },
  ];

  /* GDELT writes place names as "City, Region, Country" — sometimes just
     "Country". The last segment is the country either way. */
  function countryOf(name) {
    if (!name) return null;
    const parts = String(name).split(',').map((s) => s.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  }

  /* GDELT has returned counts under a few different property names over the
     years, and occasionally as a string. Be liberal; default to one mention. */
  function countOf(props) {
    const raw = props && (props.count != null ? props.count
      : props.Count != null ? props.Count
      : props.mentions != null ? props.mentions : null);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  /* Aggregate raw GEO responses into a ranked table.
     `responses` is [{ dimension, geojson }] — a dimension whose request failed
     is simply absent, and the index is computed from whatever arrived. */
  function aggregate(responses) {
    const countries = {};
    const points = [];
    const dims = [];

    responses.forEach(({ dimension, geojson }) => {
      const feats = (geojson && geojson.features) || [];
      if (!feats.length) return;
      dims.push(dimension.key);
      feats.forEach((f) => {
        const props = f && f.properties;
        const country = countryOf(props && props.name);
        if (!country) return;
        const n = countOf(props);
        const row = countries[country] || (countries[country] = { country, score: 0, parts: {}, total: 0 });
        row.parts[dimension.key] = (row.parts[dimension.key] || 0) + n;
        row.score += n * dimension.weight;
        row.total += n;

        const coords = f.geometry && f.geometry.coordinates;
        if (coords && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
          points.push({
            lon: coords[0], lat: coords[1], count: n,
            kind: dimension.key, color: dimension.color,
            place: String(props.name || country), country: country,
          });
        }
      });
    });

    const ranked = Object.values(countries).sort((a, b) => b.score - a.score);
    const top = ranked.length ? ranked[0].score : 0;
    ranked.forEach((r) => { r.index = top ? Math.round((r.score / top) * 100) : 0; });

    return { ranked, points, dimensions: dims, mentions: points.reduce((s, p) => s + p.count, 0) };
  }

  global.Instability = { DIMENSIONS, aggregate, countryOf, countOf };
})(typeof window !== 'undefined' ? window : globalThis);
