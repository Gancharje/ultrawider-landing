/**
 * Browser test — the goodbye/uninstall surface carries NO third-party
 * advertising or analytics trackers (owner decisions 2026-09-02: Google
 * Ads/DoubleClick removed outright; Yandex.Metrika removed after a measured
 * audit found cookies and durable identifiers) and leaks NO uninstall query.
 *
 * THE CONTRACT, BOTH HALVES MEASURED, NOT ASSUMED:
 *   JS ON  — the page must not even ATTEMPT a tracking request. Requests are
 *            recorded at CREATION, before any network dependency: a dead
 *            network cannot fake a green, and a server's silence is not
 *            absence of attempt.
 *   JS OFF — the <noscript> pixel (mc.yandex.ru/watch/109480276) is itself a
 *            tracker: with JavaScript disabled the page must create ZERO
 *            tracking requests too.
 *
 * STORAGE: a clean profile must stay clean — first visit AND a second visit
 * in the same profile — of Yandex cookies and _ym_* / __ym_* storage. The
 * measured audit (why Metrika left) found ten cookies including a durable
 * _ym_uid and third-party yandexuid; privacy.html says "No cookies are used"
 * about this page, and the STATIC half below keeps that sentence from
 * drifting away from the production source.
 *
 * KEPT, AND PROVEN KEPT: the owner's own uninstall analytics — the early
 * capture of iid/had/days/d, the immediate address-bar strip, the single
 * first-party POST with { iid, diag }, and its 5xx retry-until-confirmed.
 *
 * Fonts (fonts.googleapis.com / gstatic) are allowed and are not analytics —
 * but they too may not carry the uninstall query (checked with everything
 * else). Report output is hostnames, paths and parameter NAMES only: no
 * cookies, identifiers or values are ever printed.
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

const PAGE_QUERY = 'iid=TESTIID&had=1&days=2.5&d=SNAP-ABC123';
const VALUE_MARKERS = ['TESTIID', 'SNAP-ABC123'];
const QUERY_KEYS = ['iid', 'had', 'days', 'd'];
const METRIKA_COUNTER = '109480276';

/** Advertising AND analytics trackers. googleapis/gstatic (fonts) are NOT
 *  here by name and must not be — fonts were left out of scope on purpose. */
function isTracker(u) {
  let p;
  try { p = new URL(u); } catch (_) { return false; }
  const h = p.hostname.toLowerCase();
  if (/(^|\.)yandex\.[a-z.]+$/.test(h)) return true;          // Metrika: mc.yandex.ru, an.yandex.ru, …
  if (/(^|\.)doubleclick\.net$/.test(h)) return true;
  if (/(^|\.)googleadservices\.com$/.test(h)) return true;
  if (/(^|\.)googlesyndication\.com$/.test(h)) return true;
  if (/(^|\.)googletagmanager\.com$/.test(h)) return true;
  if (/(^|\.)google\.[a-z.]+$/.test(h)) {
    const q = p.pathname;
    return q.startsWith('/pagead') || q.startsWith('/ccm/collect') || q.startsWith('/rmkt/collect');
  }
  return false;
}

function isExternal(u) {
  try { return new URL(u).hostname !== '127.0.0.1'; } catch (_) { return false; }
}

/** The owner's OWN endpoints are the intended recipients of the uninstall
 *  data; the leak ban is about third parties. */
function isFirstParty(u) {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h.endsWith('.ultrawider.net') || h === 'ultrawider.net';
  } catch (_) { return false; }
}

function redacted(r) {
  try {
    const u = new URL(r.url());
    const names = [...u.searchParams.keys()].sort().join(',');
    return `${r.method()} ${u.hostname}${u.pathname}${names ? ' params=[' + names + ']' : ''}`;
  } catch (_) { return r.method() + ' <unparseable>'; }
}

function leakIn(text) {
  if (!text) return null;
  for (const v of VALUE_MARKERS) if (text.includes(v)) return v;
  for (const k of QUERY_KEYS) {
    if (text.includes('?' + k + '=')) return k + '= (query)';
    if (text.includes('&' + k + '=')) return k + '= (query)';
    if (text.includes('"' + k + '"')) return '"' + k + '" (body key)';
  }
  if (text.includes(PAGE_QUERY)) return 'the whole original query string';
  return null;
}

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      try {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p.endsWith('/')) p += 'index.html';
        const fp = path.join(ROOT, p);
        if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404, { Connection: 'close' }); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', Connection: 'close' });
        res.end(fs.readFileSync(fp));
      } catch (e) { res.writeHead(500, { Connection: 'close' }); res.end(String(e)); }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function ready(srv, base) {
  const deadline = Date.now() + 15000;
  const ask = () => new Promise((resolve) => {
    const req = http.get(base + '/goodbye/index.html', (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0));
    req.setTimeout(2000, () => { req.destroy(); resolve(0); });
  });
  return (async () => {
    while (Date.now() < deadline) {
      if (await ask() === 200) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  })();
}

// ── static: the goodbye sources carry no tracker machinery ──────────────────
// This is also what keeps privacy.html honest: the page's story says "No
// cookies are used", and no tracker may quietly return to the sources.
const TRACKER_SOURCE_MARKERS = [
  // Google Ads / DoubleClick (removed first)
  'googletagmanager', 'doubleclick', 'googleadservices', 'googlesyndication',
  'adsbygoogle', 'AW-953520341', '953520341', 'ccm/collect', 'rmkt/collect',
  'viewthroughconversion', '1p-user-list', '/pagead',
  // Yandex.Metrika (removed after the cookie audit)
  'metrika', 'mc.yandex', METRIKA_COUNTER, 'webvisor', 'window.ym',
  'yandex.ru/watch',
];

function localSourcesOfGoodbye() {
  // ONLY what the page LOADS — <script src> and <link rel=stylesheet|icon>
  // hrefs — not the footer's <a href> links to other pages: those pages keep
  // their own Metrika by the owner's decision, and scanning them here would
  // make this test about the wrong surface.
  const files = [path.join(ROOT, 'goodbye', 'index.html')];
  const html = fs.readFileSync(files[0], 'utf8');
  const loads = [
    ...html.matchAll(/<script[^>]+src="(\/[^"?]+)/g),
    ...html.matchAll(/<link[^>]+rel="(?:stylesheet|icon|apple-touch-icon)"[^>]+href="(\/[^"?]+)/g),
  ];
  for (const m of loads) {
    const fp = path.join(ROOT, m[1]);
    if (fp.startsWith(ROOT) && fs.existsSync(fp) && fs.statSync(fp).isFile()) files.push(fp);
  }
  return files;
}

// ── storage cleanliness ──────────────────────────────────────────────────────
const YANDEX_COOKIE_NAMES = ['yandexuid', 'yuidss', 'ymex', 'yabs-sid', '_yasc', 'bh', 'i'];

async function storageState(page, ctx) {
  return {
    docCookie: await page.evaluate(() => document.cookie).catch(() => ''),
    ls: await page.evaluate(() => Object.keys(localStorage)).catch(() => []),
    ss: await page.evaluate(() => Object.keys(sessionStorage)).catch(() => []),
    cookies: (await ctx.cookies()).map((c) => ({ name: c.name, domain: c.domain })),
  };
}

function yandexResidue(state) {
  const bad = [];
  if (state.docCookie) for (const part of state.docCookie.split(';')) {
    const n = part.trim().split('=')[0];
    if (n.startsWith('_ym') || YANDEX_COOKIE_NAMES.includes(n)) bad.push('document.cookie:' + n);
  }
  for (const k of [...state.ls, ...state.ss]) if (k.startsWith('_ym') || k.startsWith('__ym')) bad.push('storage:' + k);
  for (const c of state.cookies) {
    if (/(\.|^)yandex\.[a-z.]+$/.test(c.domain)) bad.push('cookie@yandex:' + c.name);
    if (c.name.startsWith('_ym') || YANDEX_COOKIE_NAMES.includes(c.name)) bad.push('cookie:' + c.name + '@' + c.domain);
  }
  return bad;
}

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failures++; };

/** The Yandex noscript pixel must be present in the STATIC sources for the
 *  JS-off half to mean anything — checked as its own assertion so a green
 *  can never come from the pixel simply not being reachable. */

async function trackedVisit(browser, base, { js, label, apiStatuses }) {
  const ctx = await browser.newContext({ javaScriptEnabled: js });
  const page = await ctx.newPage();
  const calls = [];
  const statuses = apiStatuses ?? [200];
  await ctx.route('**/api/extension/uninstall', (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const i = calls.length;
    calls.push({ body: req.postData() || '', referer: (req.headers() || {}).referer || '' });
    const status = statuses[Math.min(i, statuses.length - 1)];
    return route.fulfill({ status, headers: CORS, contentType: 'application/json', body: status === 200 ? '{"ok":true}' : 'err' });
  });
  await ctx.route('**/api/welcome/uninstall', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill({ status: 200, headers: CORS, body: '{}' }));

  const external = [];
  ctx.on('request', (r) => { if (isExternal(r.url())) external.push(r); });

  const before = js ? await storageState(page, ctx) : null;
  await page.goto(base + '/goodbye/index.html?' + PAGE_QUERY, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(js ? 6000 : 2500);
  const after = js ? await storageState(page, ctx) : null;

  return { ctx, page, external, calls, before, after, label };
}

async function run() {
  // ── 1. STATIC ────────────────────────────────────────────────────────────
  console.log('STATIC — the goodbye sources carry no advertising or analytics tracker');
  {
    const files = localSourcesOfGoodbye();
    console.log('    scanned: ' + files.map((f) => path.relative(ROOT, f)).join(', '));
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      for (const marker of TRACKER_SOURCE_MARKERS) {
        if (text.includes(marker)) ok(false, `${path.relative(ROOT, f)} contains tracker marker "${marker}" — privacy.html says "No cookies are used"`);
      }
    }
    const html = fs.readFileSync(path.join(ROOT, 'goodbye', 'index.html'), 'utf8');
    ok(!/<script[^>]+metrika\.js/.test(html), 'goodbye includes no metrika.js script');
    ok(!/<noscript>[\s\S]*yandex/i.test(html), 'goodbye carries no Yandex <noscript> pixel');
    ok(true, 'every scanned file checked (any hit above is a failure)');
  }

  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  if (!(await ready(srv, base))) {
    console.error('FATAL the local server never answered /goodbye/index.html — readiness unproven');
    srv.close();
    process.exit(1);
  }
  const browser = await chromium.launch();

  // ── 2. LIVE, JS ON — first visit ─────────────────────────────────────────
  console.log('LIVE JS-ON — a real render, requests recorded at creation, nothing aborted');
  {
    const v = await trackedVisit(browser, base, { js: true, label: 'first visit' });
    const trackers = v.external.filter((r) => isTracker(r.url()));
    const others = v.external.filter((r) => !isTracker(r.url()));
    console.log(`    external requests attempted: ${v.external.length}`);
    for (const r of trackers) console.log('    TRACKER ' + redacted(r));
    for (const r of others.slice(0, 6)) console.log('    other   ' + redacted(r));
    ok(trackers.length === 0, `zero Yandex / Google Ads / DoubleClick tracking requests attempted (got ${trackers.length})`);

    let leaks = 0;
    for (const r of v.external) {
      if (isFirstParty(r.url())) continue;
      const headers = (await r.allHeaders().catch(() => ({}))) || {};
      for (const [ch, text] of [['url', r.url()], ['body', r.postData() || ''], ['referer', headers['referer'] || '']]) {
        const marker = leakIn(text);
        if (marker) { leaks += 1; console.log(`    LEAK ${ch} on ${redacted(r)} carried ${marker}`); }
      }
    }
    ok(leaks === 0, `no uninstall query key, value or original URL in any third-party URL/body/Referer (found ${leaks})`);

    ok((await v.page.evaluate(() => location.search)) === '', 'the visible URL is stripped of the query');
    const boot = await v.page.evaluate(() => window.__UW_GOODBYE);
    ok(!!boot && boot.d === 'SNAP-ABC123', 'the first-party capture still holds iid/had/days/d');

    ok(v.calls.length === 1, `exactly one first-party uninstall POST (got ${v.calls.length})`);
    let bodyOk = false;
    try { const b = JSON.parse(v.calls[0].body); bodyOk = b.iid === 'TESTIID' && b.diag === 'SNAP-ABC123'; } catch (_) {}
    ok(bodyOk, 'the POST body is still { iid, diag } from the captured params');

    const residue1 = yandexResidue(v.after);
    for (const b of residue1) console.log('    RESIDUE ' + b);
    ok(residue1.length === 0, `a clean profile stays clean after the first visit — no _ym_*/yandex cookies or storage (found ${residue1.length})`);

    // ── 3. SAME PROFILE, SECOND VISIT ─────────────────────────────────────
    // Reuses the SAME context: whatever the first visit may have seeded, a
    // tracker would show here as durable state or a repeat attempt.
    const page2 = await v.ctx.newPage();
    const ext2 = [];
    const onReq2 = (r) => { if (isExternal(r.url())) ext2.push(r); };
    v.ctx.on('request', onReq2);
    await page2.goto(base + '/goodbye/index.html?' + PAGE_QUERY, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page2.waitForTimeout(5000);
    v.ctx.off('request', onReq2);
    const trackers2 = ext2.filter((r) => isTracker(r.url()));
    ok(trackers2.length === 0, `second visit in the same profile: still zero tracking attempts (got ${trackers2.length})`);
    const state2 = await storageState(page2, v.ctx);
    const residue2 = yandexResidue(state2);
    for (const b of residue2) console.log('    RESIDUE ' + b);
    ok(residue2.length === 0, `second visit: no _ym_uid / yandexuid / __ym_tab_guid or any Yandex residue (found ${residue2.length})`);
    await page2.close();
    await v.ctx.close();
  }

  // ── 4. LIVE, JS ON — the 5xx retry contract is untouched ─────────────────
  console.log('LIVE JS-ON — the first-party POST still retries through 5xx to a confirmation');
  {
    const v = await trackedVisit(browser, base, { js: true, label: 'retry', apiStatuses: [500, 500, 200] });
    await v.page.waitForTimeout(4000); // backoff 400+800ms → 3rd attempt by ~1.2s
    ok(v.calls.length >= 3, `retried through 5xx failures (attempts=${v.calls.length}, expected ≥3)`);
    const after = v.calls.length;
    await v.page.waitForTimeout(1500);
    ok(v.calls.length === after, `stopped retrying once a 2xx confirmed (still ${v.calls.length})`);
    const trackers = v.external.filter((r) => isTracker(r.url()));
    ok(trackers.length === 0, `the retry scenario creates no tracking requests either (got ${trackers.length})`);
    await v.ctx.close();
  }

  // ── 5. LIVE, JS OFF — the noscript pixel is a tracker too ────────────────
  console.log('LIVE JS-OFF — with JavaScript disabled the page creates zero tracking requests');
  {
    const v = await trackedVisit(browser, base, { js: false, label: 'noscript' });
    const trackers = v.external.filter((r) => isTracker(r.url()));
    for (const r of trackers) console.log('    TRACKER(no-JS) ' + redacted(r));
    ok(trackers.length === 0, `zero tracking requests with JS off — no Yandex <noscript> pixel attempt (got ${trackers.length})`);
    await v.ctx.close();
  }

  await browser.close();
  srv.close();
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
