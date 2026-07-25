/* ═══════════════════════════════════════════════════════════════
   Universe Monitor — world exchange sessions
   Original work © AI Humane Technologies.

   Which of the world's major exchanges are trading right now, and what
   opens or closes next. This is computed on the device from published
   trading hours and the IANA timezone database (via Intl) — no feed to
   rate-limit, no key, and it keeps working when every API is down.

   Public holidays are NOT modelled: an exchange shown as open may be
   closed for a national holiday. Session times are the main continuous
   auction; pre-open and closing auctions are excluded.
   ═══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const WEEKDAYS = [1, 2, 3, 4, 5];        // Mon–Fri
  const SUN_THU = [0, 1, 2, 3, 4];         // Gulf working week

  /* [openMinutes, closeMinutes] in local wall-clock time. Two entries where the
     exchange breaks for lunch. */
  const hm = (h, m) => h * 60 + (m || 0);

  const LIST = [
    { code: 'NYSE',   city: 'New York',   tz: 'America/New_York',    days: WEEKDAYS, sessions: [[hm(9, 30), hm(16, 0)]] },
    { code: 'NASDAQ', city: 'New York',   tz: 'America/New_York',    days: WEEKDAYS, sessions: [[hm(9, 30), hm(16, 0)]] },
    { code: 'TSX',    city: 'Toronto',    tz: 'America/Toronto',     days: WEEKDAYS, sessions: [[hm(9, 30), hm(16, 0)]] },
    { code: 'B3',     city: 'São Paulo',  tz: 'America/Sao_Paulo',   days: WEEKDAYS, sessions: [[hm(10, 0), hm(17, 55)]] },
    { code: 'LSE',    city: 'London',     tz: 'Europe/London',       days: WEEKDAYS, sessions: [[hm(8, 0), hm(16, 30)]] },
    { code: 'EURONEXT', city: 'Paris',    tz: 'Europe/Paris',        days: WEEKDAYS, sessions: [[hm(9, 0), hm(17, 30)]] },
    { code: 'XETRA',  city: 'Frankfurt',  tz: 'Europe/Berlin',       days: WEEKDAYS, sessions: [[hm(9, 0), hm(17, 30)]] },
    { code: 'SIX',    city: 'Zurich',     tz: 'Europe/Zurich',       days: WEEKDAYS, sessions: [[hm(9, 0), hm(17, 20)]] },
    { code: 'BIST',   city: 'Istanbul',   tz: 'Europe/Istanbul',     days: WEEKDAYS, sessions: [[hm(10, 0), hm(18, 0)]] },
    { code: 'JSE',    city: 'Johannesburg', tz: 'Africa/Johannesburg', days: WEEKDAYS, sessions: [[hm(9, 0), hm(17, 0)]] },
    { code: 'TADAWUL', city: 'Riyadh',    tz: 'Asia/Riyadh',         days: SUN_THU,  sessions: [[hm(10, 0), hm(15, 0)]] },
    { code: 'DFM',    city: 'Dubai',      tz: 'Asia/Dubai',          days: WEEKDAYS, sessions: [[hm(10, 0), hm(14, 0)]] },
    { code: 'NSE',    city: 'Mumbai',     tz: 'Asia/Kolkata',        days: WEEKDAYS, sessions: [[hm(9, 15), hm(15, 30)]] },
    { code: 'SGX',    city: 'Singapore',  tz: 'Asia/Singapore',      days: WEEKDAYS, sessions: [[hm(9, 0), hm(12, 0)], [hm(13, 0), hm(17, 0)]] },
    { code: 'HKEX',   city: 'Hong Kong',  tz: 'Asia/Hong_Kong',      days: WEEKDAYS, sessions: [[hm(9, 30), hm(12, 0)], [hm(13, 0), hm(16, 0)]] },
    { code: 'SSE',    city: 'Shanghai',   tz: 'Asia/Shanghai',       days: WEEKDAYS, sessions: [[hm(9, 30), hm(11, 30)], [hm(13, 0), hm(15, 0)]] },
    { code: 'TSE',    city: 'Tokyo',      tz: 'Asia/Tokyo',          days: WEEKDAYS, sessions: [[hm(9, 0), hm(11, 30)], [hm(12, 30), hm(15, 30)]] },
    { code: 'KRX',    city: 'Seoul',      tz: 'Asia/Seoul',          days: WEEKDAYS, sessions: [[hm(9, 0), hm(15, 30)]] },
    { code: 'TWSE',   city: 'Taipei',     tz: 'Asia/Taipei',         days: WEEKDAYS, sessions: [[hm(9, 0), hm(13, 30)]] },
    { code: 'ASX',    city: 'Sydney',     tz: 'Australia/Sydney',    days: WEEKDAYS, sessions: [[hm(10, 0), hm(16, 0)]] },
  ];

  /* Minutes that a timezone is ahead of UTC at this instant. Read from Intl, so
     DST is whatever the tz database says — no offset table to go stale. */
  const _dtf = {};
  function tzOffsetMinutes(tz, date) {
    let f = _dtf[tz];
    if (!f) {
      f = _dtf[tz] = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    }
    const p = {};
    f.formatToParts(date).forEach((x) => { p[x.type] = x.value; });
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day,
      p.hour === '24' ? 0 : +p.hour, +p.minute, +p.second);
    return Math.round((asUTC - date.getTime()) / 60000);
  }

  const pad = (n) => String(n).padStart(2, '0');

  /* Status for one exchange at a given instant.
     The countdown is measured in local wall-clock minutes. If a DST change
     falls between now and the next boundary the countdown is an hour out for
     those few hours a year; the open/closed state itself is always right. */
  function statusAt(ex, date) {
    const now = date || new Date();
    const off = tzOffsetMinutes(ex.tz, now);
    const local = new Date(now.getTime() + off * 60000);
    const day = local.getUTCDay();
    const mins = local.getUTCHours() * 60 + local.getUTCMinutes();

    let open = false, next = null;
    for (let d = 0; d <= 8 && !next; d++) {
      const idx = (day + d) % 7;
      if (ex.days.indexOf(idx) === -1) continue;
      for (const [s, e] of ex.sessions) {
        const toOpen = d * 1440 + s - mins;
        const toClose = d * 1440 + e - mins;
        if (toOpen <= 0 && toClose > 0) { open = true; next = { kind: 'close', in: toClose }; break; }
        if (toOpen > 0) { next = { kind: 'open', in: toOpen }; break; }
      }
    }

    return {
      open: open,
      localTime: pad(local.getUTCHours()) + ':' + pad(local.getUTCMinutes()),
      next: next,
      hours: ex.sessions
        .map(([s, e]) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}–${pad(Math.floor(e / 60))}:${pad(e % 60)}`)
        .join(', '),
    };
  }

  function countdown(mins) {
    if (mins == null) return '';
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    if (h < 24) return `${h}h ${mins % 60}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
  }

  function snapshot(date) {
    const now = date || new Date();
    return LIST.map((ex) => Object.assign({ ex: ex }, statusAt(ex, now)));
  }

  global.Exchanges = { LIST, statusAt, snapshot, countdown, tzOffsetMinutes };
})(typeof window !== 'undefined' ? window : globalThis);
