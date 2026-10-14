/** One-shot visual contract check for the survey page rework (owner 14.10):
 *  site header + footer present, and the form + Send fit one 1080p viewport. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('file:///C:/Users/user/Desktop/ultrawider-landing/survey/index.html', { waitUntil: 'load' });
  const m = await page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) };
    };
    return {
      header: r('.site-header'),
      footer: r('.site-footer'),
      send: r('.submit'),
      q4: r('#q4'),
      formBottom: Math.max(...[...document.querySelectorAll('.q')].map((q) => q.getBoundingClientRect().bottom)),
      docHeight: document.documentElement.scrollHeight,
      viewport: window.innerHeight,
    };
  });
  console.log(JSON.stringify(m, null, 1));
  const ok =
    m.header && m.footer && m.send &&
    m.send.bottom <= m.viewport &&      // Send visible without scroll
    m.formBottom <= m.viewport &&       // all questions on screen
    m.footer.top < m.docHeight;
  console.log(ok ? 'PASS: header+footer present, Send fits one screen' : 'FAIL');
  await page.screenshot({ path: 'C:/Users/user/Desktop/widescope/gate-logs/survey-rework.png', fullPage: false });
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
