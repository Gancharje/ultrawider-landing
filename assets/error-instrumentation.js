/**
 * Frontend error instrumentation — catches uncaught JS errors and
 * unhandled promise rejections, ships them to the backend so they
 * land in the admin "Unified errors" view.
 *
 * Design choices:
 *  - 60s client-side dedup per (msg + source) so a busted loop doesn't
 *    spam us with thousands of identical reports.
 *  - sendBeacon when available so the report survives even if the
 *    user navigates away mid-error (e.g. an error during pagehide).
 *  - Best-effort: any send failure is swallowed; we never want the
 *    error reporter itself to throw and create a feedback loop.
 *  - Filters out third-party noise: cross-origin "Script error." and
 *    common browser-extension violations that aren't actionable.
 */
(function () {
  var ULTRAWIDER = window.ULTRAWIDER || {};
  var API_BASE = ULTRAWIDER.API_BASE || 'https://api.ultrawider.net';
  var ENDPOINT = API_BASE + '/api/error-report';

  // 60s dedup — key by error message + filename.
  var recentlySent = Object.create(null);
  var DEDUP_WINDOW_MS = 60 * 1000;

  function shouldDrop(msg) {
    if (!msg) return true;
    // Cross-origin script errors are uninformative — browsers strip
    // the message and stack so we can't act on them.
    if (msg === 'Script error.' || msg === 'Script error') return true;
    // Common extension noise (other extensions injecting code).
    if (msg.indexOf('chrome-extension://') !== -1) return true;
    if (msg.indexOf('moz-extension://') !== -1) return true;
    if (msg.indexOf('ResizeObserver loop') !== -1) return true;
    return false;
  }

  function send(payload) {
    var body = JSON.stringify(payload);
    // Plain fetch with credentials:'omit' — sendBeacon would send
    // cookies by default which trips CORS preflight. keepalive:true
    // gives us the same «survives tab close» behaviour without the
    // credentials baggage.
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        mode: 'cors',
        credentials: 'omit',
      }).catch(function () { /* swallow */ });
    } catch (_) { /* swallow */ }
  }

  function report(kind, msg, stack, extra) {
    if (shouldDrop(msg)) return;
    var key = kind + '|' + msg;
    var now = Date.now();
    var lastSent = recentlySent[key] || 0;
    if (now - lastSent < DEDUP_WINDOW_MS) return;
    recentlySent[key] = now;

    send({
      source: 'landing',
      msg: String(msg).slice(0, 500),
      stack: stack ? String(stack).slice(0, 4000) : undefined,
      url: location.href,
      user_agent: navigator.userAgent,
      extra: Object.assign({ kind: kind }, extra || {}),
    });
  }

  window.addEventListener('error', function (e) {
    if (!e) return;
    var msg = e.message || (e.error && e.error.message) || 'unknown error';
    var stack = e.error && e.error.stack;
    report('window.onerror', msg, stack, {
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
    });
  });

  window.addEventListener('unhandledrejection', function (e) {
    if (!e) return;
    var reason = e.reason;
    var msg = reason instanceof Error ? reason.message
      : typeof reason === 'string' ? reason
      : (function () { try { return JSON.stringify(reason); } catch { return String(reason); } })();
    var stack = reason instanceof Error ? reason.stack : undefined;
    report('unhandledrejection', msg, stack);
  });

  // Expose a manual report helper so app code can ship structured
  // domain errors (e.g. checkout-failed states) on the same channel.
  window.UW_REPORT_ERROR = function (msg, extra) {
    report('manual', msg, undefined, extra);
  };
})();
