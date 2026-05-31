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

  var payload = {
    aspect_tier: tier,
    screen_w: screenW,
    screen_h: screenH,
    dpr: dpr,
    referrer: document.referrer || '',
    utm_source: param('utm_source') || '',
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
})();
