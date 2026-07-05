/**
 * Landing audience stats — one POST per browser session.
 *
 * Sends to two destinations:
 *   1. Yandex.Metrica via ym('userParams') — for heatmap/segment analysis
 *      in their dashboard.
 *   2. Our own backend /api/landing-visit — so the admin panel has cold
 *      aggregate counts without depending on Metrica's UI.
 *
 * Aspect tier boundaries match `widescope/src/shared/aspect-ratio.ts`
 * exactly so landing visitors and extension activations can be unioned
 * by tier in the admin metrics view.
 *
 * Dedup: sessionStorage flag `_uw_audience_sent`. One report per tab
 * session — refreshing or navigating internally doesn't re-fire.
 */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  try {
    if (sessionStorage.getItem('_uw_audience_sent') === '1') return;
  } catch (_) { /* sessionStorage blocked → just send once per page load */ }

  function classifyAspect(w, h) {
    if (!w || !h) return 'standard';
    var r = w / h;
    if (r >= 3.0) return 'super-ultrawide-32-9';
    if (r >= 2.6) return 'ultrawide-24-9';
    if (r >= 2.1) return 'ultrawide-21-9';
    return 'standard';
  }

  function param(name) {
    try {
      return new URLSearchParams(location.search).get(name);
    } catch (_) { return null; }
  }

  var screenW = (window.screen && window.screen.width) || 0;
  var screenH = (window.screen && window.screen.height) || 0;
  var dpr = window.devicePixelRatio || 1;
  var tier = classifyAspect(screenW, screenH);

  // Source attribution: full utm_source wins, short ?ref=/-?r= (what we
  // put in reddit/HN/YT links — less spammy than full UTM strings) fills
  // the same slot. Persisted per-session so store-button clicks on later
  // pages keep the original source even after the query string is gone.
  var srcParam = param('utm_source') || param('ref') || param('r') || '';
  try {
    if (srcParam) sessionStorage.setItem('_uw_src', srcParam);
    else srcParam = sessionStorage.getItem('_uw_src') || '';
  } catch (_) { /* sessionStorage blocked → per-page attribution only */ }
  try {
    if (document.referrer && !sessionStorage.getItem('_uw_ref')) {
      sessionStorage.setItem('_uw_ref', document.referrer);
    }
  } catch (_) {}

  var payload = {
    aspect_tier: tier,
    screen_w: screenW,
    screen_h: screenH,
    dpr: dpr,
    referrer: document.referrer || '',
    utm_source: srcParam,
    utm_medium: param('utm_medium') || '',
    utm_campaign: param('utm_campaign') || '',
    landing_path: location.pathname || '/',
  };

  // 1. Yandex.Metrica userParams — rich segmentation in their dashboard.
  //    We use a nested "audience" object so it stays grouped and doesn't
  //    pollute the top-level userParams namespace.
  try {
    if (window.UW_METRIKA && typeof window.UW_METRIKA.userParams === 'function') {
      window.UW_METRIKA.userParams({
        audience: {
          aspect_tier: tier,
          screen_w: screenW,
          screen_h: screenH,
          aspect_ratio: screenW && screenH ? (screenW / screenH).toFixed(2) : '0',
          dpr: dpr,
        },
      });
    }
  } catch (_) { /* never let metrika kill the page */ }

  // 2. Our backend — survives even if Metrica is blocked by an extension.
  var ULTRAWIDER = window.ULTRAWIDER || {};
  var API_BASE = ULTRAWIDER.API_BASE || 'https://api.ultrawider.net';
  var url = API_BASE + '/api/landing-visit';
  var body = JSON.stringify(payload);

  function send() {
    // Plain fetch with credentials:'omit' — sendBeacon would send
    // cookies/credentials by default, which trips CORS preflight on
    // api.ultrawider.net (Access-Control-Allow-Credentials not set
    // since we don't need cookies on this endpoint). keepalive:true
    // lets the request survive a tab close mid-flight, matching the
    // behaviour we wanted from sendBeacon.
    try {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        mode: 'cors',
        credentials: 'omit',
      }).then(markSent).catch(function () {});
    } catch (_) { /* swallow */ }
  }

  function markSent() {
    try { sessionStorage.setItem('_uw_audience_sent', '1'); } catch (_) {}
  }

  // Defer until after the page has painted so we don't compete with
  // the hero render. requestIdleCallback if available, else 1s timeout.
  if (window.requestIdleCallback) {
    requestIdleCallback(send, { timeout: 2000 });
  } else {
    setTimeout(send, 1000);
  }

  // ── store-button click beacons ────────────────────────────────────
  // Delegated listener: any anchor leading to a store (or the checkout
  // flow) fires one beacon with the session's source attribution. This
  // is what turns the admin channels table from "visits" into
  // "visits → intent" per traffic source. Never blocks navigation.
  function classifyTarget(href) {
    if (!href) return null;
    if (href.indexOf('chromewebstore.google.com') !== -1 || href.indexOf('chrome.google.com/webstore') !== -1) return 'chrome';
    if (href.indexOf('microsoftedge.microsoft.com') !== -1) return 'edge';
    if (href.indexOf('addons.mozilla.org') !== -1) return 'firefox';
    if (href.indexOf('/checkout') !== -1) return 'checkout';
    if (href.indexOf('#pricing') !== -1) return 'pricing';
    return null;
  }

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var target = classifyTarget(a.getAttribute('href') || '');
    if (!target) return;
    var src = '';
    var ref = '';
    try {
      src = sessionStorage.getItem('_uw_src') || '';
      ref = sessionStorage.getItem('_uw_ref') || document.referrer || '';
    } catch (_) { ref = document.referrer || ''; }
    try {
      fetch(API_BASE + '/api/landing-click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: target,
          referrer: ref,
          utm_source: src,
          landing_path: location.pathname || '/',
        }),
        keepalive: true,
        mode: 'cors',
        credentials: 'omit',
      }).catch(function () {});
    } catch (_) { /* never interfere with the click */ }
  }, { capture: true, passive: true });
})();
