/**
 * Browser test — the goodbye/uninstall surface fires NO ad pixels (owner
 * decision, 2026-09-02) and leaks NO uninstall query anywhere.
 *
 * What happened before the removal: the goodbye page included
 * /assets/error-instrumentation.js, whose top block is the shared Google Ads
 * gtag loader (AW-953520341). On a real render it fired Google Ads /
 * DoubleClick remarketing and conversion requests — google.com/ccm/collect,
 * ad.doubleclick.net, googleads.g.doubleclick.net/pagead/viewthroughconversion
 * /953520341, google.com|google.ru/pagead/1p-user-list — from the very page
 * a user lands on the moment they REMOVE the extension.
 *
 * This scene renders the page FOR REAL: no blanket route abort anywhere.
 * Requests are RECORDED as they are created (the request event fires before
 * any network dependency, so a dead network cannot fake a green), the ad
 * attempts are named redacted — method, host, path, PARAMETER NAMES ONLY —
 * and any leak of the uninstall query (its keys, its values, or the whole
 * original URL) into any external URL, body or Referer fails the run.
 *
 * Nothing here may print a cookie, a Google identifier, or a parameter
 * VALUE: the report is hostnames, paths and key names.
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
// The query's KEYS. Matched as '&key=' / '?key=' / 'key=' inside URLs,
// bodies and Referers, and as JSON keys inside bodies.
const QUERY_KEYS = ['iid', 'had', 'days', 'd'];

/** Ad endpoints: the named ones and their equivalents. googleapis (fonts)
 *  is NOT here and must not be — that is a different decision. */
function isAd(u) {
  let p;
  try { p = new URL(u); } catch (_) { return false; }
  const h = p.hostname.toLowerCase();
  const adHost = /(^|\.)doubleclick\.net$/.test(h)
    || /(^|\.)googleadservices\.com$/.test(h)
    || /(^|\.)googlesyndication\.com$/.test(h)
    || /(^|\.)googletagmanager\.com$/.test(h);
  if (adHost) return true;
  // google.com / google.ru etc. are general-purpose hosts: match by AD PATHS.
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
 *  data (the first-party POST is explicitly kept); the leak ban is about
 *  third parties. ultrawider.net and its subdomains are first-party. */
function isFirstParty(u) {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h.endsWith('.ultrawider.net') || h === 'ultrawider.net';
  } catch (_) { return false; }
}

/** Redacted one-liner for a request: names, never values. */
function redacted(r) {
  try {
    const u = new URL(r.url());
    const names = [...u.searchParams.keys()].sort().join(',');
    return `${r.method()} ${u.hostname}${u.pathname}${names ? ' params=[' + names + ']' : ''}`;
  } catch (_) { return r.method() + ' <unparseable>'; }
}

/** Does `text` leak the uninstall query? Returns the marker it leaked. */
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

// ── static: the goodbye sources carry no ad machinery ───────────────────────
const AD_SOURCE_MARKERS = [
  'googletagmanager', 'doubleclick', 'googleadservices', 'googlesyndication',
  'adsbygoogle', 'AW-953520341', '953520341', 'ccm/collect', 'rmkt/collect',
  'viewthroughconversion', '1p-user-list', '/pagead',
];

function localSourcesOfGoodbye() {
  const files = [path.join(ROOT, 'goodbye', 'index.html')];
  const html = fs.readFileSync(files[0], 'utf8');
  for (const m of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
    const fp = path.join(ROOT, m[1].split('?')[0]);
    if (fp.startsWith(ROOT) && fs.existsSync(fp) && fs.statSync(fp).isFile()) files.push(fp);
  }
  return files;
}

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failures++; };

async function run() {
  // ── 1. STATIC: no ad loader, id or endpoint in the goodbye sources ──────
  console.log('STATIC — the goodbye sources carry no ad machinery');
  {
    const files = localSourcesOfGoodbye();
    console.log('    scanned: ' + files.map((f) => path.relative(ROOT, f)).join(', '));
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      for (const marker of AD_SOURCE_MARKERS) {
        if (text.includes(marker)) {
          ok(false, `${path.relative(ROOT, f)} contains the ad marker "${marker}"`);
        }
      }
    }
    ok(true, 'every scanned file checked (any hit is printed above as a failure)');
  }

  // ── 2. LIVE: a real render, nothing aborted ──────────────────────────────
  console.log('LIVE — a real render of the uninstall page, requests recorded, nothing aborted');
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  if (!(await ready(srv, base))) {
    console.error('FATAL the local server never answered /goodbye/index.html — readiness unproven');
    srv.close();
    process.exit(1);
  }
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const calls = [];
  // FIRST-PARTY ONLY: the uninstall POST is mocked so the scene never talks
  // to the real backend. Everything else — fonts, metrics, ADS — goes out
  // for real; that is the point.
  await ctx.route('**/api/extension/uninstall', (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    calls.push({ body: req.postData() || '', referer: (req.headers() || {}).referer || '' });
    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{"ok":true}' });
  });
  await ctx.route('**/api/welcome/uninstall', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill({ status: 200, headers: CORS, body: '{}' }));

  const external = [];
  ctx.on('request', (r) => { if (isExternal(r.url())) external.push(r); });

  await page.goto(base + '/goodbye/index.html?' + PAGE_QUERY, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // A window for late pixels (the loader is async; the lists follow the
  // conversion). Generous on purpose: a green must not depend on timing.
  await page.waitForTimeout(6000);

  const adAttempts = external.filter((r) => isAd(r.url()));
  const others = external.filter((r) => !isAd(r.url()));

  // THE FACT ITSELF: no ad request may even be ATTEMPTED from this page.
  console.log(`    external requests attempted: ${external.length} (recorded at creation — network state cannot hide one)`);
  for (const r of adAttempts) console.log('    AD   ' + redacted(r));
  for (const r of others.slice(0, 6)) console.log('    other ' + redacted(r));
  ok(adAttempts.length === 0, `zero Google Ads / DoubleClick requests attempted (got ${adAttempts.length})`);

  // THE LEAK CHECK: no uninstall query key, value, or the whole original
  // URL in any THIRD-PARTY URL, body or Referer. The owner's own endpoints
  // are the contractual recipients and are excluded by name.
  let leaks = 0;
  for (const r of external) {
    if (isFirstParty(r.url())) continue;
    const headers = (await r.allHeaders().catch(() => ({}))) || {};
    const referer = headers['referer'] || '';
    for (const [label, text] of [['url', r.url()], ['body', r.postData() || ''], ['referer', referer]]) {
      const marker = leakIn(text);
      if (marker) {
        leaks += 1;
        // REDACTED BY DESIGN: names the channel and the marker kind, never
        // the value it carried.
        console.log(`    LEAK ${label} on ${redacted(r)} carried ${marker}`);
      }
    }
  }
  ok(leaks === 0, `no uninstall query key, value or original URL in any external URL/body/Referer (found ${leaks})`);

  // THE ADDRESS BAR: stripped, and every external Referer is the clean URL.
  ok((await page.evaluate(() => location.search)) === '', 'the visible URL is stripped of the query');
  const boot = await page.evaluate(() => window.__UW_GOODBYE);
  ok(!!boot && boot.d === 'SNAP-ABC123', 'the first-party capture still holds iid/had/days/d (window.__UW_GOODBYE)');

  // THE FIRST-PARTY CONTRACT: exactly one confirmed POST, same shape.
  ok(calls.length === 1, `exactly one first-party uninstall POST (got ${calls.length})`);
  let bodyOk = false;
  try { const b = JSON.parse(calls[0].body); bodyOk = b.iid === 'TESTIID' && b.diag === 'SNAP-ABC123'; } catch (_) {}
  ok(bodyOk, 'the POST body is still { iid, diag } from the captured params');

  await ctx.close();
  await browser.close();
  srv.close();
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
