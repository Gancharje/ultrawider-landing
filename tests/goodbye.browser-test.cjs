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
        if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
        res.end(fs.readFileSync(fp));
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failures++; };

async function blockExternal(page) {
  await page.route(/googleapis|gstatic|mc\.yandex\.ru|yandex|watch\/\d/, (r) => r.abort().catch(() => {}));
}
function mockWelcomeUninstall(page) {
  return page.route('**/api/welcome/uninstall', (r) => r.request().method() === 'OPTIONS'
    ? r.fulfill({ status: 204, headers: CORS })
    : r.fulfill({ status: 200, headers: CORS, body: '{}' }));
}

async function run() {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();

  // ── Scenario 1: SUCCESS ────────────────────────────────────────────────
  console.log('SCENARIO 1 — success (2xx): one confirmed send, d captured before strip');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const calls = [];
    await page.route('**/api/extension/uninstall', (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      calls.push(req.postData());
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{"ok":true}' });
    });
    await mockWelcomeUninstall(page);
    await blockExternal(page);
    await page.goto(base + '/goodbye/index.html?iid=TESTIID&had=1&days=2.5&d=SNAP-ABC123', { waitUntil: 'load' });
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
    await page.route('**/api/extension/uninstall', (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      calls.push(Date.now());
      const status = calls.length < 3 ? 500 : 200; // fail twice, then succeed
      return route.fulfill({ status, headers: CORS, contentType: 'application/json', body: status === 200 ? '{"ok":true}' : 'err' });
    });
    await mockWelcomeUninstall(page);
    await blockExternal(page);
    await page.goto(base + '/goodbye/index.html?iid=IID2&had=0&days=0.1&d=SNAP-XYZ', { waitUntil: 'load' });
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
