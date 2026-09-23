/**
 * Leak-sensor patch (migration 022) — dwell_ms on the goodbye page.
 *
 * Two behaviours the September data demanded:
 *   1. A reason click carries dwell_ms (how long the page was open).
 *   2. Leaving without answering fires ONE "no_response" beacon with
 *      dwell_ms — the page-load row alone cannot tell "ignored the
 *      question" from "closed the tab instantly".
 * Also: the no_response beacon must NOT fire after an answer.
 */
const { chromium } = require('playwright');
const path = require('path');

const PAGE = 'file://' + path.resolve(__dirname, '../goodbye/index.html');
const TARGET = 'https://api.ultrawider.net';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const posts = [];
  await page.route(TARGET + '/api/welcome/uninstall', (route) => {
    posts.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill({ status: 204, body: '' });
  });
  await page.route(TARGET + '/api/extension/uninstall', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));

  const results = [];
  const check = (name, ok, extra) => {
    results.push([name, ok, extra]);
    console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok ? '' : ' — ' + (extra ?? '')));
  };

  // SCENARIO 1 — the user answers after ~1.2s: the reason beacon carries dwell_ms
  await page.goto(PAGE + '?iid=dwell-click-test&had=1&days=2.5');
  await page.waitForTimeout(1200);
  await page.click('.gb-btn[data-reason="didnt_work"]');
  await page.waitForTimeout(400);
  const reasonPost = posts.find((p) => p.body && p.body.reason === 'didnt_work');
  check('reason beacon fired', !!reasonPost);
  check('reason beacon carries dwell_ms >= 1000', !!reasonPost && typeof reasonPost.body.dwell_ms === 'number' && reasonPost.body.dwell_ms >= 1000,
    reasonPost && JSON.stringify(reasonPost.body));

  // SCENARIO 2 — a fresh page, the user leaves without answering
  posts.length = 0;
  await page.goto(PAGE + '?iid=dwell-silent-test&had=0&days=0.1');
  await page.waitForTimeout(800);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.waitForTimeout(300);
  const nr = posts.filter((p) => p.body && p.body.reason === 'no_response');
  check('exactly one no_response beacon on silent pagehide', nr.length === 1, 'got ' + nr.length);
  check('no_response carries dwell_ms >= 500', nr.length === 1 && typeof nr[0].body.dwell_ms === 'number' && nr[0].body.dwell_ms >= 500,
    nr.length === 1 && JSON.stringify(nr[0].body));

  // SCENARIO 3 — after an answer, pagehide must NOT add a no_response
  posts.length = 0;
  await page.goto(PAGE + '?iid=dwell-answered-test&had=1&days=1.0');
  await page.click('.gb-btn[data-reason="other"]');
  await page.waitForTimeout(200);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.waitForTimeout(300);
  const nrAfter = posts.filter((p) => p.body && p.body.reason === 'no_response');
  check('no no_response after an answer', nrAfter.length === 0, 'got ' + nrAfter.length);

  await browser.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(failed.length ? `\nFAIL (${failed.length})` : '\nALL PASS');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
