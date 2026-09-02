/**
 * Browser test for /goodbye diagnostics forwarding (round-4 §1).
 *
 * Drives the REAL goodbye page in Chromium and asserts:
 *   - the `d` snapshot is captured in the head BEFORE replaceState strips the
 *     query (the bug: the body used to read the already-emptied location.search
 *     and forward nothing);
 *   - SUCCESS: a 2xx POSTs the snapshot to /api/extension/uninstall exactly
 *     once, body = { iid, diag:<snapshot> }, and does NOT re-fire;
 *   - FAILURE: 5xx responses trigger a real bounded retry with backoff until a
 *     2xx confirms, then it stops.
 *
 * Self-contained: a tiny static server serves the site, page.route mocks the
 * API (no network). Run: `npm test` (needs `playwright` + chromium installed).
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      try {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p.endsWith('/')) p += 'index.html';
        const fp = path.join(ROOT, p);
        // CONNECTION: CLOSE ON PURPOSE. A keep-alive test server races the
        // browser's pooled sockets: a navigation that reuses a socket the
        // server has just idled out hangs on 'load' for the full timeout
        // (measured twice on the very page an earlier scenario had just
        // loaded green — scenario 2's goto, after the readiness gate already
        // proved the server serves). A test server serves a handful of
        // requests; no reuse is a cost of nothing and removes the class.
        if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404, { Connection: 'close' }); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', Connection: 'close' });
        res.end(fs.readFileSync(fp));
      } catch (e) { res.writeHead(500, { Connection: 'close' }); res.end(String(e)); }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/** PROVEN READINESS, not an assumed port. `listen`'s callback says the socket
 *  is bound; it does not say the loop has turned or the exact resource the
 *  scenarios navigate to is served. Under the hybrid gate's load the first
 *  `page.goto` met a bound-but-not-yet-serving server and burned its whole
 *  30s timeout in the browser (measured: gate-logs/landing-tests.log, the
 *  final 2C gate's attempt 4). The scenarios start only after the goodbye
 *  page itself ANSWERS a real request — and if it never does, the failure
 *  names the server instead of a navigation timeout. */
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

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failures++; };

async function blockExternal(page) {
  // THE SUITE'S OWN CONTRACT SAYS "no network" — so block NETWORK, not a
  // list of guesses. The old narrow regex covered fonts and Yandex but not
  // the goodbye page's Google Ads/DoubleClick remarketing pixels: the trace
  // of a hang shows real requests to google.com, google.ru and
  // doubleclick.net leaving the test browser, and one hanging regional
  // request (www.google.ru/pagead/…) pinned 'load' for the full 30s goto
  // timeout — the final gate's landing flake, in both scenarios.
  //
  // REGISTERED FIRST ON PURPOSE. The page POSTs its diagnostics to the
  // PRODUCTION endpoint (https://ultrawider.net/api/extension/uninstall),
  // which the scenarios intercept by pattern and fulfil; Playwright runs the
  // LATEST-registered route first, so this block must sit below them in
  // registration order. Everything the mocked endpoints do not claim and
  // that is not the local server is aborted: no tracking leakage from a
  // test, no dependence on the machine's network, no hang class.
  await page.route(/^(?!http:\/\/127\.0\.0\.1:[0-9]+\/)/, (r) => r.abort().catch(() => {}));
}
function mockWelcomeUninstall(page) {
  return page.route('**/api/welcome/uninstall', (r) => r.request().method() === 'OPTIONS'
    ? r.fulfill({ status: 204, headers: CORS })
    : r.fulfill({ status: 200, headers: CORS, body: '{}' }));
}

/** Navigate with a request trace: WHEN a goto hangs on 'load', the timeout
 *  alone cannot say which resource never finished. The trace prints the last
 *  few network events, so a hang names its own pending thing. */
async function gotoTraced(page, url, trace) {
  const ev = [];
  trace.push(ev);
  const onReq = (r) => ev.push(`> ${r.method()} ${r.url().slice(0, 120)}`);
  const onRes = (r) => ev.push(`< ${r.status()} ${r.url().slice(0, 120)}`);
  const onFail = (r) => ev.push(`x ${r.failure()?.errorText} ${r.url().slice(0, 120)}`);
  page.on('request', onReq); page.on('response', onRes); page.on('requestfailed', onFail);
  try {
    await page.goto(url, { waitUntil: 'load' });
  } catch (e) {
    console.error('TRACE tail before goto failure:\n  ' + ev.slice(-12).join('\n  '));
    throw e;
  } finally {
    page.off('request', onReq); page.off('response', onRes); page.off('requestfailed', onFail);
  }
}

async function run() {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  if (!(await ready(srv, base))) {
    console.error('FATAL the local server never answered /goodbye/index.html — readiness unproven, refusing to start the browser scenarios');
    srv.close();
    process.exit(1);
  }
  const browser = await chromium.launch();

  // ── Scenario 1: SUCCESS ────────────────────────────────────────────────
  console.log('SCENARIO 1 — success (2xx): one confirmed send, d captured before strip');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const calls = [];
    await blockExternal(page);
    await page.route('**/api/extension/uninstall', (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      calls.push(req.postData());
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{"ok":true}' });
    });
    await mockWelcomeUninstall(page);
    await gotoTraced(page, base + "/goodbye/index.html?iid=TESTIID&had=1&days=2.5&d=SNAP-ABC123", []);
    const boot = await page.evaluate(() => window.__UW_GOODBYE);
    ok(boot && boot.d === 'SNAP-ABC123', 'head captured d before replaceState (window.__UW_GOODBYE.d)');
    ok((await page.evaluate(() => location.search)) === '', 'query string stripped from the visible URL');
    await page.waitForTimeout(800);
    ok(calls.length === 1, `exactly one diag POST on success (got ${calls.length})`);
    let bodyOk = false;
    try { const b = JSON.parse(calls[0]); bodyOk = b.iid === 'TESTIID' && b.diag === 'SNAP-ABC123'; } catch (_) {}
    ok(bodyOk, 'diag POST body = { iid, diag:<snapshot> } from the captured param (not the stripped URL)');
    await page.waitForTimeout(1200);
    ok(calls.length === 1, `no retry after a confirmed 2xx (still ${calls.length})`);
    await ctx.close();
  }

  // ── Scenario 2: FAILURE → retry → recovery ─────────────────────────────
  console.log('SCENARIO 2 — failure (5xx): real retry with backoff until a 2xx confirms');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const calls = [];
    await blockExternal(page);
    await page.route('**/api/extension/uninstall', (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      calls.push(Date.now());
      const status = calls.length < 3 ? 500 : 200; // fail twice, then succeed
      return route.fulfill({ status, headers: CORS, contentType: 'application/json', body: status === 200 ? '{"ok":true}' : 'err' });
    });
    await mockWelcomeUninstall(page);
    await gotoTraced(page, base + "/goodbye/index.html?iid=IID2&had=0&days=0.1&d=SNAP-XYZ", []);
    await page.waitForTimeout(3000); // backoff 400+800ms → 3rd attempt by ~1.2s
    ok(calls.length >= 3, `retried through 5xx failures (attempts=${calls.length}, expected ≥3)`);
    const after = calls.length;
    await page.waitForTimeout(1500);
    ok(calls.length === after, `stopped retrying once a 2xx confirmed (still ${calls.length})`);
    await ctx.close();
  }

  await browser.close();
  srv.close();
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error('FATAL', e); process.exit(1); });
