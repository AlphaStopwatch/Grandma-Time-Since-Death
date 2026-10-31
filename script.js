/* THE ETERNAL MEMORIAL — script.js
 *
 * Memorial start (fixed, never modified): 2026-10-31 17:12:00 Asia/Dhaka (UTC+06:00)
 * Elapsed time is always recalculated as: NOW - START. Nothing is stored or accumulated,
 * so refreshing, closing, sleeping or restarting a device can never lose time.
 *
 * Bangladesh uses a fixed UTC+06:00 offset (no daylight saving), so Dhaka wall-clock
 * time is computed from UTC with a fixed +6h shift. This does not depend on the
 * device's configured time zone.
 */
(function () {
  'use strict';

  /* ---------- constants ---------- */
  var DHAKA_OFFSET_MS = 6 * 3600000;
  var START_Y = 2026, START_MO = 9, START_D = 31, START_H = 17, START_MI = 12, START_S = 0; // month 9 = October
  var START_WALL = Date.UTC(START_Y, START_MO, START_D, START_H, START_MI, START_S); // Dhaka wall time as UTC number
  var START_UTC = START_WALL - DHAKA_OFFSET_MS;                                      // 2026-10-31T11:12:00Z
  var SYNC_EVERY_MS = 5 * 60 * 1000;
  var SYNC_FRESH_MS = 15 * 60 * 1000;
  var MIN_VALID = Date.UTC(2026, 9, 31);
  var MAX_VALID = Date.UTC(2300, 0, 1);

  var WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  var MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST',
                'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

  /* ---------- clock state ---------- */
  var offsetMs = 0;        // trusted time minus device time (0 = device clock)
  var online = false;      // true only while a recent successful sync exists
  var lastSync = 0;        // device timestamp of last successful sync
  var syncing = false;
  var tickTimer = null;

  function trustedNow() {
    return Date.now() + offsetMs;
  }

  /* ---------- calendar arithmetic ---------- */
  // Dhaka wall-clock moment of "start + m calendar months" (day clamped to month length).
  function anchorWall(m) {
    var total = START_MO + m;
    var y = START_Y + Math.floor(total / 12);
    var mo = total % 12;
    var dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    return Date.UTC(y, mo, Math.min(START_D, dim), START_H, START_MI, START_S);
  }

  function compute(nowUtc) {
    var nowWall = nowUtc + DHAKA_OFFSET_MS;
    if (nowWall < START_WALL) nowWall = START_WALL; // device clock set before the memorial: show zero

    var w = new Date(nowWall);

    // Complete calendar months elapsed
    var months = (w.getUTCFullYear() - START_Y) * 12 + (w.getUTCMonth() - START_MO);
    if (months < 0) months = 0;
    if (anchorWall(months) > nowWall) months -= 1;
    if (months < 0) months = 0;

    var remMs = nowWall - anchorWall(months);
    var remDays = Math.floor(remMs / 86400000);
    var remHours = Math.floor((remMs % 86400000) / 3600000);

    // Exact elapsed duration (BigInt, no precision limit)
    var totalSeconds = BigInt(Math.floor((nowWall - START_WALL) / 1000));
    var totalDays = totalSeconds / 86400n;
    var dayHours = (totalSeconds % 86400n) / 3600n;
    var totalHours = totalSeconds / 3600n;
    var minutes = (totalSeconds % 3600n) / 60n;
    var seconds = totalSeconds % 60n;

    return {
      years: Math.floor(months / 12),
      monthsInYear: months % 12,
      totalMonths: months,
      remDays: remDays,
      remHours: remHours,
      totalDays: totalDays,
      dayHours: Number(dayHours),
      totalHours: totalHours,
      minutes: Number(minutes),
      seconds: Number(seconds),
      wall: w
    };
  }

  /* ---------- formatting ---------- */
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function group(big) {
    return big.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function plural(n, one, many) {
    return String(n) === '1' || n === 1 || n === 1n ? one : many;
  }

  function time12(w) {
    var h = w.getUTCHours();
    var ap = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 || 12;
    return h12 + ':' + pad2(w.getUTCMinutes()) + ':' + pad2(w.getUTCSeconds()) + ' ' + ap;
  }

  /* ---------- DOM (written only when text changes) ---------- */
  var cache = Object.create(null);
  var els = Object.create(null);

  function el(id) {
    if (!els[id]) els[id] = document.getElementById(id);
    return els[id];
  }

  function setText(id, text) {
    if (cache[id] === text) return;
    cache[id] = text;
    var node = el(id);
    if (node) node.textContent = text;
  }

  function render() {
    var d = compute(trustedNow());

    // FACE 01 — years, months, days
    setText('y-years', String(d.years));
    setText('y-years-l', plural(d.years, 'YEAR', 'YEARS'));
    setText('y-months', pad2(d.monthsInYear));
    setText('y-months-l', plural(d.monthsInYear, 'MONTH', 'MONTHS'));
    setText('y-days', pad2(d.remDays));
    setText('y-days-l', plural(d.remDays, 'DAY', 'DAYS'));

    // FACE 02 — total days, hours, minutes
    setText('d-days', group(d.totalDays));
    setText('d-days-l', plural(d.totalDays, 'DAY', 'DAYS'));
    setText('d-hours', pad2(d.dayHours));
    setText('d-hours-l', plural(d.dayHours, 'HOUR', 'HOURS'));
    setText('d-minutes', pad2(d.minutes));
    setText('d-minutes-l', plural(d.minutes, 'MINUTE', 'MINUTES'));

    // FACE 03 — total hours, minutes, seconds
    setText('h-hours', group(d.totalHours));
    setText('h-hours-l', plural(d.totalHours, 'HOUR', 'HOURS'));
    setText('h-minutes', pad2(d.minutes));
    setText('h-minutes-l', plural(d.minutes, 'MINUTE', 'MINUTES'));
    setText('h-seconds', pad2(d.seconds));
    setText('h-seconds-l', plural(d.seconds, 'SECOND', 'SECONDS'));

    // Current Bangladesh date and time
    // Current Dhaka date for the header (separate from the clamped counter time)
    var cur = new Date(trustedNow() + DHAKA_OFFSET_MS);
    setText('curWeekday', WEEKDAYS[cur.getUTCDay()]);
    setText('curDay', String(cur.getUTCDate()));
    setText('curMonth', MONTHS[cur.getUTCMonth()]);
    setText('curYear', String(cur.getUTCFullYear()));
    setText('curTime', time12(cur));

    updateBadge();
  }

  function updateBadge() {
    var live = online && navigator.onLine !== false && (Date.now() - lastSync) < SYNC_FRESH_MS;
    var badge = el('sourceBadge');
    var text = live ? 'ONLINE — BANGLADESH TIME' : 'OFFLINE — DEVICE TIME';
    if (cache.badge === text) return;
    cache.badge = text;
    if (badge) {
      badge.textContent = text;
      badge.setAttribute('data-state', live ? 'online' : 'offline');
    }
  }

  /* ---------- ticking (aligned to second boundaries, no drift) ---------- */
  function tick() {
    render();
    var now = trustedNow();
    var delay = 1000 - (now % 1000) + 8;
    tickTimer = setTimeout(tick, delay);
  }

  function restartTick() {
    if (tickTimer) clearTimeout(tickTimer);
    tick();
  }

  /* ---------- online time synchronisation ---------- */
  function valid(ms) {
    return typeof ms === 'number' && isFinite(ms) && ms > MIN_VALID && ms < MAX_VALID;
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
    var opts = options || {};
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(url, opts).then(
      function (r) { if (timer) clearTimeout(timer); return r; },
      function (e) { if (timer) clearTimeout(timer); throw e; }
    );
  }

  // Each source resolves to a UTC millisecond timestamp (server time at response).
  var SOURCES = [
    function worldTimeApi() {
      return fetchWithTimeout('https://worldtimeapi.org/api/timezone/Asia/Dhaka', { cache: 'no-store' }, 6000)
        .then(function (r) { if (!r.ok) throw new Error('http'); return r.json(); })
        .then(function (j) {
          var ms = typeof j.unixtime === 'number' ? j.unixtime * 1000 : Date.parse(j.utc_datetime);
          if (!valid(ms)) throw new Error('invalid');
          return ms;
        });
    },
    function timeApiIo() {
      return fetchWithTimeout('https://timeapi.io/api/time/current/zone?timeZone=Asia%2FDhaka', { cache: 'no-store' }, 6000)
        .then(function (r) { if (!r.ok) throw new Error('http'); return r.json(); })
        .then(function (j) {
          // Fields are Dhaka wall time; convert to UTC with the fixed +06:00 offset.
          var ms = Date.UTC(j.year, j.month - 1, j.day, j.hour, j.minute, j.seconds, j.milliSeconds || 0) - DHAKA_OFFSET_MS;
          if (!valid(ms)) throw new Error('invalid');
          return ms;
        });
    },
    function ownServerDate() {
      // Same-origin request: the web server's Date header is a server-side UTC timestamp.
      if (!/^https?:$/.test(location.protocol)) return Promise.reject(new Error('no-origin'));
      return fetchWithTimeout(location.href.split('#')[0], { method: 'HEAD', cache: 'no-store' }, 6000)
        .then(function (r) {
          var h = r.headers.get('Date');
          var ms = h ? Date.parse(h) + 500 : NaN; // header has 1 s resolution
          if (!valid(ms)) throw new Error('invalid');
          return ms;
        });
    }
  ];

  function trySources(i) {
    if (i >= SOURCES.length) return Promise.reject(new Error('all-failed'));
    var t0 = Date.now();
    return SOURCES[i]().then(
      function (serverMs) {
        var t1 = Date.now();
        var newOffset = serverMs - (t0 + t1) / 2; // compensate for network latency
        if (!isFinite(newOffset) || Math.abs(newOffset) > 3650 * 86400000) throw new Error('offset');
        return newOffset;
      }
    ).catch(function () { return trySources(i + 1); });
  }

  function sync() {
    if (syncing) return;
    if (navigator.onLine === false) { goOffline(); return; }
    syncing = true;
    trySources(0).then(
      function (newOffset) {
        offsetMs = Math.round(newOffset);
        lastSync = Date.now();
        online = true;
        syncing = false;
        restartTick();
      },
      function () {
        syncing = false;
        goOffline(); // time services unreachable: fall back gracefully, never stop counting
      }
    );
  }

  function goOffline() {
    online = false;
    offsetMs = 0; // use the device clock (still converted to fixed UTC+06:00)
    restartTick();
  }

  /* ---------- Ameen button (honest acknowledgment only) ---------- */
  /* ---------- quiet ambience: built once, transform/opacity only ---------- */
  function setupAmbience() {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.documentElement.classList.add('js');
    var box = document.querySelector('.particles');
    if (box && !reduce) {
      var frag = document.createDocumentFragment();
      var i, s;
      for (i = 0; i < 14; i++) {          // twinkling stars
        s = document.createElement('span');
        s.className = 'p-star';
        s.style.left = (Math.random() * 100).toFixed(1) + '%';
        s.style.top = (Math.random() * 65).toFixed(1) + '%';
        s.style.animationDuration = (3 + Math.random() * 4).toFixed(1) + 's';
        s.style.animationDelay = (-Math.random() * 6).toFixed(1) + 's';
        frag.appendChild(s);
      }
      for (i = 0; i < 12; i++) {          // slow falling points of light, like quiet tears
        s = document.createElement('span');
        s.className = 'p-drop';
        s.style.left = (Math.random() * 100).toFixed(1) + '%';
        s.style.animationDuration = (16 + Math.random() * 14).toFixed(1) + 's';
        s.style.animationDelay = (-Math.random() * 28).toFixed(1) + 's';
        frag.appendChild(s);
      }
      box.appendChild(frag);
    }
    // gentle reveal as sections come into view (no scrolling is ever triggered)
    var items = document.querySelectorAll('.reveal');
    if (reduce || !('IntersectionObserver' in window)) {
      for (var k = 0; k < items.length; k++) items[k].classList.add('in');
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    for (var m = 0; m < items.length; m++) io.observe(items[m]);
  }

  /* ---------- quiet words that change slowly ---------- */
  var MISS = [
    'দাদু, তুমি নেই—কিন্তু তোমার দোয়া আজও আমার সঙ্গে আছে।',
    'তোমার ডাকটা আর শুনতে পাই না, দাদু। বুকের ভেতরটা খুব খালি লাগে।',
    'যতবার দরজার দিকে তাকাই, মনে হয় তুমি এখনই ডাকবে।',
    'দাদু, আমি তোমাকে খুব মিস করি। প্রতিদিন তোমার জন্য দোয়া করি।',
    'কিছু ভালোবাসা শেষ হয় না, দোয়ার ভেতর দিয়ে বেঁচে থাকে।',
    'হে আল্লাহ, আমার দাদীকে আপনি আপনার রহমতের ছায়ায় রাখুন।',
    'চোখের পানি থামে না, তবু আল্লাহর ফয়সালায় আমি সবর করতে চাই।',
    'দাদু, আল্লাহ তোমাকে শান্তি দিন। আমরা তোমার জন্য দোয়া করে যাব।'
  ];

  function setupMiss() {
    var node = document.getElementById('missLine');
    if (!node) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    var i = 0;
    setInterval(function () {
      if (document.visibilityState !== 'visible') return;
      node.classList.add('out');
      setTimeout(function () {
        i = (i + 1) % MISS.length;
        node.textContent = MISS[i];
        node.classList.remove('out');
      }, 900);
    }, 8000);
  }

  function setupAmeen() {
    var btn = document.getElementById('ameenBtn');
    var note = document.getElementById('ameenNote');
    if (!btn || !note) return;
    btn.addEventListener('click', function () {
      note.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
    });
  }

  /* ---------- offline caching ---------- */
  function registerWorker() {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* optional */ });
    }
  }

  /* ---------- start ---------- */
  function start() {
    setupAmbience();
    setupMiss();
    setupAmeen();
    tick();
    sync();
    setInterval(sync, SYNC_EVERY_MS);

    window.addEventListener('online', sync);
    window.addEventListener('offline', goOffline);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        restartTick(); // recalculate immediately after sleep / tab switch
        if (Date.now() - lastSync > 60000) sync();
      }
    });
    window.addEventListener('pageshow', function () { restartTick(); });

    registerWorker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
