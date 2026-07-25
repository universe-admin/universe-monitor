/* ═══════════════════════════════════════════════════════════════
   Universe Monitor — 3D globe
   Original work © AI Humane Technologies.

   An orthographic globe drawn on a 2D canvas: no WebGL, no 3D library,
   nothing to download at runtime beyond ~97 KB of coastline geometry.
   The flat map stays the default; this is the same live signals wrapped
   onto a sphere you can spin.

   HOW THE LAND IS DRAWN, AND WHY NOT AS POLYGONS

   The obvious approach — project each coastline ring and fill it — breaks
   on the two rings that circle the planet. Antarctica encloses the south
   pole and Afro-Eurasia runs right across the antimeridian; neither bounds
   a simple region in projection, so a filled path either inverts (ocean
   becomes land, every continent a hole) or sweeps a limb arc the wrong way
   round the disc. Closing them properly means pole insertion and winding
   bookkeeping for a shape the user only ever sees at a few hundred pixels.

   So the fill comes from a land mask instead: the rings are rasterised once
   into an equirectangular bitmap, and each screen pixel inside the disc is
   inverse-projected and looked up. Inverse orthographic has no special
   cases — every visible pixel maps to exactly one lat/lon. Coastlines and
   borders are then stroked as vectors on top, which needs no fill rule and
   stays crisp on high-density screens.

   The per-pixel tables depend only on the tilt, not the spin, so rotating
   costs one add and one lookup per pixel.

   Coastlines and borders: Natural Earth 1:110m (public domain) via
   world-atlas, ISC licence, © 2012–2019 Michael Bostock.
   ═══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const TAU = Math.PI * 2;
  const REDUCED = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const MASK_W = 2048, MASK_H = 1024;
  const LAND = [42, 58, 94];
  const OCEAN = [19, 26, 48];

  /* Camera-space unit vector for a lon/lat: x right, y up, z towards the
     viewer. The near hemisphere is z >= 0. */
  function makeVector(lon0, lat0) {
    const sinP = Math.sin(lat0 * RAD), cosP = Math.cos(lat0 * RAD);
    return function vector(lon, lat, out) {
      const l = (lon - lon0) * RAD, p = lat * RAD;
      const cosLat = Math.cos(p), sinLat = Math.sin(p);
      const cosL = Math.cos(l), sinL = Math.sin(l);
      out[0] = cosLat * sinL;
      out[1] = cosP * sinLat - sinP * cosLat * cosL;
      out[2] = sinP * sinLat + cosP * cosLat * cosL;
      return out;
    };
  }

  function makeProjector(lon0, lat0, R, cx, cy) {
    const vector = makeVector(lon0, lat0);
    const v = [0, 0, 0];
    return function project(lon, lat, out) {
      vector(lon, lat, v);
      const m = v[2] >= 0 ? 1 : (Math.hypot(v[0], v[1]) || 1);
      out[0] = cx + R * (v[0] / m);
      out[1] = cy - R * (v[1] / m);
      out[2] = v[2];
      return out;
    };
  }

  /* Rasterise the coastline rings into an equirectangular land mask. In this
     space they are ordinary closed polygons and the usual non-zero fill rule
     handles lakes-as-holes exactly as a map renderer would. */
  function buildMask(rings) {
    const cv = document.createElement('canvas');
    cv.width = MASK_W; cv.height = MASK_H;
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.fillStyle = '#000';
    c.fillRect(0, 0, MASK_W, MASK_H);

    const px = (lon) => (lon + 180) / 360 * MASK_W;
    const py = (lat) => (90 - lat) / 180 * MASK_H;

    c.beginPath();
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r], n = ring.length / 2;
      if (n < 3) continue;
      let minLon = Infinity, maxLon = -Infinity, sumLat = 0;
      for (let i = 0; i < n; i++) {
        const lon = ring[2 * i];
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        sumLat += ring[2 * i + 1];
      }
      c.moveTo(px(ring[0]), py(ring[1]));
      for (let i = 1; i < n; i++) c.lineTo(px(ring[2 * i]), py(ring[2 * i + 1]));
      /* Antarctica circles the planet and its southernmost vertex stops around
         -85.6°, so the polygon alone leaves a bare cap at the pole. Carry it
         down to -90 along the bottom edge. */
      if (maxLon - minLon > 350 && sumLat / n < -60) {
        c.lineTo(MASK_W, py(-90));
        c.lineTo(0, py(-90));
      }
      c.closePath();
    }
    c.fillStyle = '#fff';
    c.fill();

    const src = c.getImageData(0, 0, MASK_W, MASK_H).data;
    const mask = new Uint8Array(MASK_W * MASK_H);
    for (let i = 0, j = 0; i < mask.length; i++, j += 4) mask[i] = src[j] > 127 ? 1 : 0;
    return mask;
  }

  /* Open polylines stop at the horizon — no fill rule involved, so coastlines
     and borders can stay vectors. */
  function strokeRuns(ring, vector, R, cx, cy, ctx, v) {
    const n = ring.length / 2;
    let drawing = false;
    for (let i = 0; i < n; i++) {
      vector(ring[2 * i], ring[2 * i + 1], v);
      if (v[2] < 0) { drawing = false; continue; }
      const x = cx + R * v[0], y = cy - R * v[1];
      if (drawing) ctx.lineTo(x, y); else { ctx.moveTo(x, y); drawing = true; }
    }
  }

  function create(canvas, opts) {
    const o = opts || {};
    const ctx = canvas.getContext('2d');
    const view = { lon: -20, lat: 18, zoom: 1 };
    let world = null, mask = null;
    let markers = [];
    let hovered = null;
    let spinning = !REDUCED;
    let raf = 0, dirty = true, dragging = false, lastPointer = null, visible = false;
    let W = 0, H = 0, R = 0, cx = 0, cy = 0, dpr = 1;

    // Per-pixel inverse-projection tables; rebuilt on resize or tilt change.
    let sphereCv = null, sphereCtx = null, sphereImg = null;
    let tblLat = null, tblCol = null, tblShade = null, tblLat0 = null, tblKey = '';

    const tmp = [0, 0, 0];
    const vtmp = [0, 0, 0];

    function resize() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      dpr = Math.min(global.devicePixelRatio || 1, 2);
      W = rect.width; H = rect.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2; cy = H / 2;
      R = Math.min(W, H) / 2 * 0.86 * view.zoom;
      dirty = true;
    }

    /* The sphere raster is built at CSS resolution and scaled up on HiDPI —
       the vector coastlines drawn over it carry the sharpness. */
    function buildTables() {
      const w = Math.max(1, Math.ceil(W)), h = Math.max(1, Math.ceil(H));
      const key = w + 'x' + h + '@' + R.toFixed(2) + ':' + view.lat.toFixed(2);
      if (key === tblKey) return;
      tblKey = key;
      tblLat0 = view.lat;

      if (!sphereCv || sphereCv.width !== w || sphereCv.height !== h) {
        sphereCv = document.createElement('canvas');
        sphereCv.width = w; sphereCv.height = h;
        sphereCtx = sphereCv.getContext('2d');
        sphereImg = sphereCtx.createImageData(w, h);
        tblLat = new Int32Array(w * h);
        tblCol = new Float32Array(w * h);
        tblShade = new Float32Array(w * h);
      }

      const sinP = Math.sin(view.lat * RAD), cosP = Math.cos(view.lat * RAD);
      // Light from the upper left, so the sphere reads as a sphere.
      const lx = -0.42, ly = 0.46, lz = 0.78;

      for (let py = 0; py < h; py++) {
        const y = (cy - (py + 0.5)) / R;
        for (let px = 0; px < w; px++) {
          const i = py * w + px;
          const x = (px + 0.5 - cx) / R;
          const r2 = x * x + y * y;
          if (r2 > 1) { tblLat[i] = -1; continue; }
          const z = Math.sqrt(1 - r2);
          const lat = Math.asin(z * sinP + y * cosP) * DEG;
          const lonB = Math.atan2(x, z * cosP - y * sinP) * DEG;
          let row = Math.floor((90 - lat) / 180 * MASK_H);
          if (row < 0) row = 0; else if (row >= MASK_H) row = MASK_H - 1;
          tblLat[i] = row;
          tblCol[i] = (lonB + 180) / 360 * MASK_W;
          const d = x * lx + y * ly + z * lz;
          tblShade[i] = 0.34 + 0.66 * (d > 0 ? d : 0);
        }
      }
    }

    function drawSphereRaster() {
      buildTables();
      if (!sphereImg) return;
      const w = sphereCv.width, h = sphereCv.height;
      const data = sphereImg.data;
      const shift = view.lon / 360 * MASK_W;

      for (let i = 0, j = 0; i < w * h; i++, j += 4) {
        const row = tblLat[i];
        if (row < 0) { data[j + 3] = 0; continue; }
        let col = tblCol[i] + shift;
        col %= MASK_W;
        if (col < 0) col += MASK_W;
        const isLand = mask ? mask[row * MASK_W + (col | 0)] : 0;
        const base = isLand ? LAND : OCEAN;
        const s = tblShade[i];
        data[j] = base[0] * s;
        data[j + 1] = base[1] * s;
        data[j + 2] = base[2] * s;
        data[j + 3] = 255;
      }
      sphereCtx.putImageData(sphereImg, 0, 0);
      ctx.drawImage(sphereCv, 0, 0, w, h, 0, 0, W, H);
    }

    function drawAtmosphere() {
      const a = ctx.createRadialGradient(cx, cy, R * 0.995, cx, cy, R * 1.14);
      a.addColorStop(0, 'rgba(109,90,230,0.34)');
      a.addColorStop(1, 'rgba(109,90,230,0)');
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.14, 0, TAU);
      ctx.arc(cx, cy, R, 0, TAU, true);          // annulus: leave the disc alone
      ctx.fillStyle = a;
      ctx.fill('evenodd');
    }

    function drawGraticule(project) {
      ctx.strokeStyle = 'rgba(148,163,216,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let lon = -180; lon < 180; lon += 30) {
        let started = false;
        for (let lat = -90; lat <= 90; lat += 3) {
          project(lon, lat, tmp);
          if (tmp[2] < 0) { started = false; continue; }
          if (started) ctx.lineTo(tmp[0], tmp[1]); else { ctx.moveTo(tmp[0], tmp[1]); started = true; }
        }
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        let started = false;
        for (let lon = -180; lon <= 180; lon += 3) {
          project(lon, lat, tmp);
          if (tmp[2] < 0) { started = false; continue; }
          if (started) ctx.lineTo(tmp[0], tmp[1]); else { ctx.moveTo(tmp[0], tmp[1]); started = true; }
        }
      }
      ctx.stroke();
    }

    function drawOutlines(vector) {
      if (!world) return;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.clip();

      ctx.beginPath();
      for (let i = 0; i < world.land.length; i++) strokeRuns(world.land[i], vector, R, cx, cy, ctx, vtmp);
      ctx.strokeStyle = 'rgba(174,190,240,0.42)';
      ctx.lineWidth = 0.7;
      ctx.stroke();

      if (world.borders && world.borders.length) {
        ctx.beginPath();
        for (let i = 0; i < world.borders.length; i++) strokeRuns(world.borders[i], vector, R, cx, cy, ctx, vtmp);
        ctx.strokeStyle = 'rgba(148,163,216,0.22)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawMarkers(project) {
      const shown = [];
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        project(m.lon, m.lat, tmp);
        if (tmp[2] < 0.02) continue;                    // at or behind the limb
        shown.push({ m: m, x: tmp[0], y: tmp[1], z: tmp[2] });
      }
      shown.sort((a, b) => a.z - b.z);                  // near side drawn last
      for (let i = 0; i < shown.length; i++) {
        const s = shown[i], m = s.m;
        const fade = 0.35 + 0.65 * s.z;
        const r = Math.max(2, (m.r || 4) * (0.7 + 0.3 * s.z));
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, TAU);
        ctx.fillStyle = m.color;
        ctx.globalAlpha = fade * 0.5;
        ctx.fill();
        ctx.globalAlpha = fade;
        ctx.lineWidth = 1;
        ctx.strokeStyle = m.color;
        ctx.stroke();
        if (hovered === m) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, r + 4, 0, TAU);
          ctx.strokeStyle = '#eef1fa';
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      return shown;
    }

    let lastShown = [];

    function draw() {
      if (!W || !H) resize();
      if (!W || !H) return;
      const project = makeProjector(view.lon, view.lat, R, cx, cy);
      const vector = makeVector(view.lon, view.lat);
      ctx.clearRect(0, 0, W, H);
      drawSphereRaster();
      drawAtmosphere();
      drawGraticule(project);
      drawOutlines(vector);
      lastShown = drawMarkers(project);
      dirty = false;
    }

    function frame() {
      raf = 0;
      if (!visible) return;
      if (spinning && !dragging) { view.lon += 0.12; dirty = true; }
      if (dirty) draw();
      schedule();
    }
    function schedule() {
      if (!raf && visible) raf = global.requestAnimationFrame(frame);
    }

    /* ── interaction ─────────────────────────────────────────────────────── */

    function pointAt(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left, py = clientY - rect.top;
      let best = null, bestD = 14 * 14;
      for (let i = 0; i < lastShown.length; i++) {
        const s = lastShown[i];
        const d = (s.x - px) * (s.x - px) + (s.y - py) * (s.y - py);
        if (d < bestD) { bestD = d; best = s.m; }
      }
      return best;
    }

    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastPointer = { x: e.clientX, y: e.clientY, moved: 0 };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (dragging && lastPointer) {
        const dx = e.clientX - lastPointer.x, dy = e.clientY - lastPointer.y;
        lastPointer.moved += Math.abs(dx) + Math.abs(dy);
        lastPointer.x = e.clientX; lastPointer.y = e.clientY;
        view.lon -= dx * 0.28;
        view.lat = Math.max(-85, Math.min(85, view.lat + dy * 0.28));
        dirty = true;
        schedule();
        return;
      }
      const hit = pointAt(e.clientX, e.clientY);
      if (hit !== hovered) {
        hovered = hit;
        canvas.style.cursor = hit ? 'pointer' : 'grab';
        dirty = true;
        schedule();
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      const wasDrag = lastPointer && lastPointer.moved > 6;
      dragging = false;
      lastPointer = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!wasDrag) {
        const hit = pointAt(e.clientX, e.clientY);
        if (o.onSelect) o.onSelect(hit);
      }
      schedule();
    });
    canvas.addEventListener('pointerleave', () => {
      dragging = false; hovered = null; dirty = true; schedule();
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      view.zoom = Math.max(0.8, Math.min(3, view.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
      resize();
      schedule();
    }, { passive: false });

    // Focusable, so the globe can be spun without a mouse.
    canvas.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 15 : 5;
      if (e.key === 'ArrowLeft') view.lon -= step;
      else if (e.key === 'ArrowRight') view.lon += step;
      else if (e.key === 'ArrowUp') view.lat = Math.min(85, view.lat + step);
      else if (e.key === 'ArrowDown') view.lat = Math.max(-85, view.lat - step);
      else if (e.key === ' ' || e.key === 'Enter') spinning = !spinning;
      else return;
      e.preventDefault();
      dirty = true;
      schedule();
    });

    global.addEventListener('resize', () => { resize(); schedule(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop(); else if (canvas.isConnected && visible) start();
    });

    /* ── api ─────────────────────────────────────────────────────────────── */

    function setWorld(w) {
      world = w;
      mask = w && w.land ? buildMask(w.land) : null;
      dirty = true;
      schedule();
    }
    function setMarkers(list) { markers = list || []; dirty = true; schedule(); }
    function start() { visible = true; resize(); dirty = true; schedule(); }
    function stop() { visible = false; if (raf) global.cancelAnimationFrame(raf); raf = 0; }
    function setSpin(on) { spinning = !!on && !REDUCED; schedule(); }
    function spinTo(lon, lat) {
      view.lon = -lon;
      view.lat = Math.max(-85, Math.min(85, lat));
      dirty = true;
      schedule();
    }

    return { setWorld, setMarkers, start, stop, setSpin, spinTo, resize,
             get spinning() { return spinning; } };
  }

  global.Globe = { create, makeProjector, makeVector, buildMask };
})(window);
