/**
 * /welcome — post-install onboarding controller.
 *
 * The extension (1.0.2+) opens this page on first install with
 * ?iid=<install_id>&v=<version>&b=<browser>&dev=<0|1>. An inline head
 * script (welcome/index.html) has already captured those params into
 * window.__UW_WELCOME_BOOT, persisted the install id, and stripped the
 * query string.
 *
 * This file:
 *   1. collects hardware profile (screen, DPR, cores, memory, GPU
 *      renderer, refresh-rate estimate, aspect tier),
 *   2. waits for the extension's content-script handshake
 *      (document.documentElement.dataset.ultrawiderVersion, polled
 *      every 250 ms for up to 3 s),
 *   3. assigns one of four flows —
 *        uw_live         ultrawide + handshake → live fullscreen tutorial
 *                        (or fallback card when handshake missing /
 *                         kill-switch off / fullscreen fails)
 *        uw_grant_needed Firefox that hasn't granted host permissions
 *        std_16x9        16:9 screen — honest "nothing to fill" flow
 *        uw_no_ext       organic visitor without an install id
 *   4. reports /api/welcome/hello + funnel events. Every network call
 *      is fire-and-forget: fetch keepalive (credentials:'omit'),
 *      all wrapped — a dead API can NEVER break this page.
 *
 * Kill-switch: GET /api/welcome/config → { liveTutorial: true }. Any
 * other value, a non-200, or a fetch failure disables the live tutorial
 * and shows the static fallback card instead.
 */
(function () {
  'use strict';

  var BOOT = window.__UW_WELCOME_BOOT || {};
  var CFG = window.ULTRAWIDER || {};
  var API = CFG.API_BASE || 'https://api.ultrawider.net';
  var CONTACT = CFG.CONTACT_EMAIL || 'hello@ultrawider.net';
  var WELCOME_URL = 'https://ultrawider.net/welcome';
  // Share/copy target: the LANDING (it sells + demos without the extension);
  // /welcome needs the extension installed to be useful.
  var LANDING_URL = 'https://ultrawider.net/';
  var VALID_FLOWS = { uw_live: 1, std_16x9: 1, uw_grant_needed: 1, uw_no_ext: 1 };

  var reducedMotion = false;
  try {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) {}

  // ─── State ──────────────────────────────────────────────────────────
  var state = {
    loadTs: Date.now(),
    iid: null,
    version: BOOT.v || null,
    browser: null, // chrome | edge | firefox
    devBuild: BOOT.dev === '1',
    internal: false,
    flow: null,
    fallbackReason: null, // 'no_handshake' when uw_live renders the fallback card
    handshakeOk: false,
    liveTutorial: null, // null = config pending, true/false = resolved
    hw: null,
    fsTs: null,
    ahaTs: null,
    hudSeen: false,
    ahaSeen: false,
    tutorialFailed: false,
    helloSent: false,
    dims: { w: 0, h: 0 },
    source: null,
  };

  try {
    state.iid = BOOT.iid || localStorage.getItem('_uw_iid') || null;
    state.internal =
      localStorage.getItem('_uw_internal') === '1' || BOOT.dev === '1';
  } catch (_) {
    state.iid = BOOT.iid || null;
    state.internal = BOOT.dev === '1';
  }
  // Acquisition source persisted by the landing (audience-stats.js) in
  // localStorage — survives the landing → store → welcome new-tab hop. Used
  // only within a 30-day last-touch window (matching Google's default click
  // window) so an ancient campaign visit can't mis-attribute a later install.
  try {
    var _src = localStorage.getItem('_uw_src');
    var _srcTs = Number(localStorage.getItem('_uw_src_ts') || 0);
    if (_src && _srcTs && Date.now() - _srcTs < 30 * 86400000) {
      state.source = String(_src).slice(0, 32);
    }
  } catch (_) { /* localStorage blocked → source stays null */ }

  // ─── Beacons — NEVER block or break UX ──────────────────────────────
  function postJSON(path, payload) {
    var url = API + path;
    var body;
    try {
      body = JSON.stringify(payload);
    } catch (_) {
      return;
    }
    // NO sendBeacon here: it always sends CREDENTIALED cross-origin
    // requests, our API (deliberately) doesn't allow credentials, so
    // the browser kills the call on CORS preflight — while sendBeacon
    // still returns true ("queued"), masking the failure. This silently
    // dropped every real hello/event until 2026-07-13. fetch with
    // keepalive survives tab close just the same (see audience-stats.js).
    try {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        mode: 'cors',
        credentials: 'omit',
      }).catch(function () {});
    } catch (_) { /* swallow */ }
  }

  function sendEvent(name, data) {
    var p = { event: name };
    if (state.iid) p.install_id = state.iid;
    if (data !== undefined && data !== null) p.data = data;
    postJSON('/api/welcome/event', p);
  }

  // ─── Browser detection (param first, UA fallback) ───────────────────
  function detectBrowser() {
    if (BOOT.b === 'chrome' || BOOT.b === 'edge' || BOOT.b === 'firefox') {
      return BOOT.b;
    }
    var ua = navigator.userAgent || '';
    if (/YaBrowser/i.test(ua)) return 'chrome';
    if (/\bEdg(e|A|iOS)?\//i.test(ua)) return 'edge';
    if (/Firefox|FxiOS/i.test(ua)) return 'firefox';
    return 'chrome';
  }
  state.browser = detectBrowser();

  // ─── Screen / aspect detection ──────────────────────────────────────
  function detectDims() {
    var w = 0;
    var h = 0;
    try {
      w = (window.screen && window.screen.width) || 0;
      h = (window.screen && window.screen.height) || 0;
    } catch (_) {}
    if (!w || !h) {
      w = window.innerWidth || 0;
      h = window.innerHeight || 0;
    }
    return { w: w, h: h };
  }

  function aspectTierFor(w, h) {
    try {
      if (window.UltrawiderAspect && w && h) {
        return window.UltrawiderAspect.aspectProfileFor(w / h).tier;
      }
    } catch (_) {}
    if (!w || !h) return 'standard';
    var r = w / h;
    if (r >= 3.0) return 'super-ultrawide-32-9';
    if (r >= 2.6) return 'ultrawide-24-9';
    if (r >= 2.1) return 'ultrawide-21-9';
    return 'standard';
  }

  // Mirrors aspect-profile.js tiers, plus the width>=3200 catch for
  // very wide displays that report an unusual ratio.
  function isUltrawide(w, h) {
    if (!w || !h) return false;
    return w / h >= 2.1 || w >= 3200;
  }

  function tierLabel(w, h) {
    var tier = aspectTierFor(w, h);
    if (tier === 'super-ultrawide-32-9') return '32:9 super-ultrawide';
    if (tier === 'ultrawide-24-9') return '24:9 ultrawide';
    if (tier === 'ultrawide-21-9') return '21:9 ultrawide';
    if (isUltrawide(w, h)) return 'ultrawide';
    return '16:9';
  }

  // ─── Hardware profile ───────────────────────────────────────────────
  function gpuRenderer() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return null;
      var out = null;
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) out = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      if (!out) out = gl.getParameter(gl.RENDERER);
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return out ? String(out).slice(0, 200) : null;
    } catch (_) {
      return null;
    }
  }

  // Count rAF frames over ~500 ms and snap to the nearest common rate.
  // Backgrounded tabs never tick rAF → the 1.5 s guard reports null.
  function estimateRefresh(cb) {
    var done = false;
    function settle(v) {
      if (done) return;
      done = true;
      cb(v);
    }
    try {
      var frames = 0;
      var start = null;
      function step(ts) {
        if (done) return;
        if (start === null) {
          start = ts;
          requestAnimationFrame(step);
          return;
        }
        frames++;
        if (ts - start < 500) {
          requestAnimationFrame(step);
          return;
        }
        var hz = frames / ((ts - start) / 1000);
        var common = [60, 75, 120, 144, 165, 240];
        var best = common[0];
        var diff = Infinity;
        for (var i = 0; i < common.length; i++) {
          var d = Math.abs(common[i] - hz);
          if (d < diff) {
            diff = d;
            best = common[i];
          }
        }
        settle(best);
      }
      requestAnimationFrame(step);
      setTimeout(function () { settle(null); }, 1500);
    } catch (_) {
      settle(null);
    }
  }

  function collectHardware(cb) {
    var dims = detectDims();
    state.dims = dims;
    var hw = {
      screen_w: dims.w,
      screen_h: dims.h,
      dpr: window.devicePixelRatio || 1,
      lang: navigator.language || null,
      hw_cores: navigator.hardwareConcurrency || null,
      hw_memory_gb: typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null,
      gpu: gpuRenderer(),
      aspect_tier: aspectTierFor(dims.w, dims.h),
      refresh_hz: null,
    };
    estimateRefresh(function (hz) {
      hw.refresh_hz = hz;
      state.hw = hw;
      cb(hw);
    });
  }

  // ─── Extension handshake ────────────────────────────────────────────
  function readHandshake() {
    try {
      var d = document.documentElement && document.documentElement.dataset;
      return (d && d.ultrawiderVersion) || null;
    } catch (_) {
      return null;
    }
  }

  function pollHandshake(cb) {
    var started = Date.now();
    var v = readHandshake();
    if (v) {
      cb({ ok: true, latency_ms: 0, version: v });
      return;
    }
    var iv = setInterval(function () {
      var val = readHandshake();
      if (val) {
        clearInterval(iv);
        cb({ ok: true, latency_ms: Date.now() - started, version: val });
        return;
      }
      if (Date.now() - started >= 3000) {
        clearInterval(iv);
        cb({ ok: false, latency_ms: null, version: null });
      }
    }, 250);
  }

  // ─── Kill-switch config ─────────────────────────────────────────────
  var configWaiters = [];
  function fetchConfig() {
    var settled = false;
    function settle(v) {
      if (settled) return;
      settled = true;
      state.liveTutorial = v;
      var w = configWaiters;
      configWaiters = [];
      for (var i = 0; i < w.length; i++) {
        try { w[i](v); } catch (_) {}
      }
    }
    try {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var t = setTimeout(function () {
        try { if (ctrl) ctrl.abort(); } catch (_) {}
        settle(false);
      }, 2500);
      fetch(API + '/api/welcome/config', {
        mode: 'cors',
        credentials: 'omit',
        signal: ctrl ? ctrl.signal : undefined,
      })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          clearTimeout(t);
          settle(!!(j && j.liveTutorial === true));
        })
        .catch(function () {
          clearTimeout(t);
          settle(false);
        });
    } catch (_) {
      settle(false);
    }
  }
  function whenConfig(cb) {
    if (state.liveTutorial !== null) {
      cb(state.liveTutorial);
      return;
    }
    configWaiters.push(cb);
  }

  // ─── Flow assignment ────────────────────────────────────────────────
  function assignFlow(handshakeOk) {
    state.fallbackReason = null;
    if (BOOT.force && VALID_FLOWS[BOOT.force]) {
      // Internal-testing hook (?force=) — affects BRANCHING only.
      state.flow = BOOT.force;
      return;
    }
    var uw = isUltrawide(state.dims.w, state.dims.h);
    if (!state.iid) {
      state.flow = 'uw_no_ext';
      return;
    }
    if (!uw) {
      state.flow = 'std_16x9';
      return;
    }
    if (handshakeOk) {
      state.flow = 'uw_live';
      return;
    }
    if (state.browser === 'firefox') {
      state.flow = 'uw_grant_needed';
      return;
    }
    state.flow = 'uw_live';
    state.fallbackReason = 'no_handshake';
  }

  // ─── DOM helpers ────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function onceVisible(el, fn) {
    if (!el) return;
    if (!('IntersectionObserver' in window)) {
      fn();
      return;
    }
    try {
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            io.disconnect();
            fn();
            return;
          }
        }
      }, { threshold: 0.35 });
      io.observe(el);
    } catch (_) {}
  }

  // ─── Shared shell: status bar + page title ──────────────────────────
  /** Move the shared status bar into the active flow's slot so it sits
   *  flush on top of that flow's content instead of floating in space. */
  function mountStatusbar() {
    var bar = $('wl-statusbar');
    if (!bar) return;
    if (state.flow === 'uw_no_ext') {
      var park = $('statusbar-park');
      if (park && bar.parentNode !== park) park.appendChild(bar);
      return;
    }
    var host = state.flow === 'std_16x9' ? $('flow-std') : $('flow-uw');
    var slot = host ? host.querySelector('[data-statusbar-slot]') : null;
    if (slot && bar.parentNode !== slot) slot.appendChild(bar);
    var parked = $('statusbar-park');
    if (parked) parked.hidden = true;
  }

  /** Detection text + override toggle, always consistent with the ACTIVE
   *  branch (the old chip kept saying "21:9 ultrawide" above a "this screen
   *  is 16:9" verdict after an override — a contradiction on screen). */
  function updateStatus() {
    var detect = $('wl-detect');
    var btn = $('wl-override');
    if (!detect || !btn) return;
    var d = state.dims;
    var detected = d.w && d.h ? d.w + '×' + d.h + ' · ' + tierLabel(d.w, d.h) : 'screen unknown';
    var flowUw = state.flow !== 'std_16x9' && state.flow !== 'uw_no_ext';
    var detectedUw = d.w && d.h ? isUltrawide(d.w, d.h) : flowUw;
    var overridden = Boolean(d.w && d.h) && detectedUw !== flowUw;
    if (!overridden) {
      detect.textContent = detected;
      btn.textContent = 'Not this monitor?';
    } else {
      detect.textContent = 'Set up for: ' + (flowUw ? 'an ultrawide' : 'a 16:9 screen') + ' (manual)';
      btn.textContent = '← Use detected: ' + detected;
    }
    btn.hidden = state.flow === 'uw_no_ext';
  }

  function renderHeadline() {
    var h = $('wl-headline');
    var noext = $('wl-headline-noext');
    if (state.flow === 'uw_no_ext') {
      if (noext) noext.hidden = false;
      if (h) h.hidden = true;
      return;
    }
    if (noext) noext.hidden = true;
    if (!h) return;
    if (state.flow === 'std_16x9') {
      // The 16:9 flow opens with its own verdict headline.
      h.hidden = true;
    } else {
      h.hidden = false;
      h.textContent =
        state.flow === 'uw_grant_needed'
          ? 'One Firefox permission — then one click.'
          : 'One more click — it’s on the video below.';
    }
  }

  // Move the single shared warp-demo playground into a flow's slot.
  function moveSimTo(slotId, badgeText) {
    var park = $('sim-park');
    var slot = $(slotId);
    if (!park || !slot) return;
    var monitor = park.firstElementChild || document.querySelector('.wl-sim-monitor');
    if (!monitor) return;
    var badge = $('sim-badge');
    if (badge && badgeText) badge.textContent = badgeText;
    slot.appendChild(monitor);
    park.hidden = true;
  }

  // sim_demo_engaged — once, on the visitor's first real interaction.
  var simEngagement = { dragged: false, slider: false, sent: false };
  function wireSimEngagement() {
    var pg = document.querySelector('[data-playground]');
    if (!pg) return;
    var divider = pg.querySelector('[data-divider]');
    var slider = pg.querySelector('input[type="range"]');
    function fire() {
      if (simEngagement.sent) return;
      simEngagement.sent = true;
      sendEvent('sim_demo_engaged', {
        dragged: simEngagement.dragged,
        slider: simEngagement.slider,
      });
    }
    if (divider) {
      var onDrag = function () {
        simEngagement.dragged = true;
        fire();
      };
      divider.addEventListener('mousedown', onDrag);
      divider.addEventListener('touchstart', onDrag, { passive: true });
      divider.addEventListener('keydown', onDrag);
    }
    if (slider) {
      slider.addEventListener('input', function () {
        simEngagement.slider = true;
        fire();
      });
    }
  }

  // ─── Live tutorial (A2) ─────────────────────────────────────────────
  var liveTutorial = {
    observer: null,
    hudTimer: null,
    fsGuardTimer: null,
    successTimer: null,
    active: false,
  };

  function isOwnNode(n) {
    if (!n || n.nodeType !== 1) return true;
    if (n.hasAttribute && n.hasAttribute('data-wl-own')) return true;
    if (n.closest && n.closest('[data-wl-own]')) return true;
    return false;
  }

  function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function exitFs() {
    try {
      if (fsElement()) {
        if (document.exitFullscreen) document.exitFullscreen().catch(function () {});
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      }
    } catch (_) {}
  }

  function setCaption(html, opts) {
    var cap = $('wl-caption');
    var txt = $('wl-caption-text');
    var arrow = $('wl-caption-arrow');
    if (!cap || !txt) return;
    txt.innerHTML = html;
    cap.hidden = false;
    cap.classList.toggle('wl-caption--success', !!(opts && opts.success));
    if (arrow) arrow.style.display = opts && opts.arrow ? '' : 'none';
    // Optional explicit exit button — the caption itself is pointer-events:
    // none (it must never block the HUD), the button opts back in.
    var btn = $('wl-caption-btn');
    if (opts && opts.action) {
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'wl-caption-btn';
        btn.className = 'wl-caption-btn';
        btn.setAttribute('data-wl-own', '');
        btn.addEventListener('click', exitFs);
        cap.appendChild(btn);
      }
      btn.textContent = opts.action;
      btn.hidden = false;
    } else if (btn) {
      btn.hidden = true;
    }
  }

  function hideCaption() {
    var cap = $('wl-caption');
    if (cap) cap.hidden = true;
  }

  function tutorialFail(reason) {
    if (state.tutorialFailed || state.ahaSeen) return;
    state.tutorialFailed = true;
    sendEvent('tutorial_failed', { reason: reason });
    teardownFsWatchers();
    exitFs();
    showFallbackCard();
  }

  function teardownFsWatchers() {
    if (liveTutorial.observer) {
      try { liveTutorial.observer.disconnect(); } catch (_) {}
      liveTutorial.observer = null;
    }
    clearTimeout(liveTutorial.hudTimer);
    clearTimeout(liveTutorial.fsGuardTimer);
    clearTimeout(liveTutorial.successTimer);
  }

  function onActivationDetected() {
    if (state.ahaSeen) return;
    state.ahaSeen = true;
    state.ahaTs = Date.now();
    clearTimeout(liveTutorial.hudTimer);
    sendEvent('aha_reached', { ms_since_load: state.ahaTs - state.loadTs });
    // Let them PLAY: no click-to-exit (a wrap-level click listener used to
    // exit fullscreen the moment they touched the HUD's slider), a long
    // grace timer, and an explicit Done button + Esc hint instead.
    setCaption(
      'That’s it — your screen, filled. 🟠 Try the popup: switch modes, drag <strong>Curve strength</strong>.',
      { success: true, arrow: false, action: 'Done — continue ↓' }
    );
    liveTutorial.successTimer = setTimeout(exitFs, 25000);
  }

  function onHudDetected() {
    if (state.hudSeen) return;
    state.hudSeen = true;
    clearTimeout(liveTutorial.hudTimer);
    sendEvent('hud_detected', { ms_since_fs: Date.now() - (state.fsTs || Date.now()) });
    setCaption(
      'That popup is <strong>Ultrawider</strong> — hover it to keep it open, then click <strong>Smoothie</strong>.',
      { arrow: true }
    );
  }

  function watchFullscreenStage(wrap, video) {
    state.fsTs = Date.now();
    if (state.ahaSeen) {
      // Re-entry after the aha: they're just playing. No timers, no arrows —
      // only the exit affordance (first exit was automatic; without this
      // hint nobody knows Esc is the way out the second time).
      setCaption('Playground mode — press <strong>Esc</strong> or hit Done to leave.', {
        arrow: false,
        action: 'Done — continue ↓',
      });
      return;
    }
    setCaption(
      'A small popup appears — <strong>that’s Ultrawider</strong>. Click <strong>Smoothie</strong>.',
      { arrow: true }
    );
    try {
      liveTutorial.observer = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === 'childList') {
            for (var j = 0; j < m.addedNodes.length; j++) {
              var n = m.addedNodes[j];
              if (!n || n.nodeType !== 1 || isOwnNode(n)) continue;
              // Any foreign node reparented into the fullscreen wrapper
              // is the extension's HUD (it mounts INTO fullscreenElement).
              onHudDetected();
              // Smoothie start = overlay <canvas> inserted above the video.
              if (n.tagName === 'CANVAS' || (n.querySelector && n.querySelector('canvas'))) {
                onActivationDetected();
              }
            }
          } else if (m.type === 'attributes' && m.target === video) {
            // Smoothie start: the ≤1.0.4 WebGL engine hid the original
            // video (visibility:hidden under an overlay canvas); the 1.0.5+
            // SVG engine keeps the video visible and instead stamps an
            // inline filter: url(#ulw-…) on it. Accept either footprint so
            // the tutorial advances for every extension version in the wild.
            try {
              if (video.style && (
                video.style.visibility === 'hidden' ||
                (video.style.filter && video.style.filter.indexOf('url(') !== -1)
              )) {
                onActivationDetected();
              }
            } catch (_) {}
          }
        }
      });
      liveTutorial.observer.observe(wrap, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'hidden'],
      });
    } catch (_) {}
    // No HUD in 4 s → exit fullscreen, log, fall back to the static card.
    liveTutorial.hudTimer = setTimeout(function () {
      if (!state.hudSeen && !state.ahaSeen) {
        tutorialFail('hud_timeout');
      }
    }, 4000);
  }

  function onFsExit() {
    teardownFsWatchers();
    hideCaption();
    var cta = $('stage-fs-cta');
    var hint = $('wl-stage-hint');
    var skip = $('uw-skip');
    if (state.ahaSeen) {
      if (hint) hint.hidden = true;
      if (skip) skip.hidden = true;
      // Keep the stage re-enterable as a playground (relabel, don't hide) —
      // re-entry auto-activates Smoothie from the saved host preference.
      if (cta && !cta.dataset.replay) {
        cta.dataset.replay = '1';
        cta.innerHTML = cta.innerHTML.replace(/Fill this video[^<]*/, 'Fullscreen again — play with it ');
      }
      // The aha happened — NOW show the next step (YouTube handoff).
      revealAfter(true);
    } else if (!state.tutorialFailed && cta) {
      cta.innerHTML = cta.innerHTML.replace('Fill this video', 'Try again');
    }
  }

  function setupLiveStage() {
    var stage = $('live-stage');
    var wrap = $('live-stage-screen');
    var video = $('live-stage-video');
    var cta = $('stage-fs-cta');
    if (!stage || !wrap || !video || !cta) return;
    stage.hidden = false;

    try { video.play().catch(function () {}); } catch (_) {}

    document.addEventListener('fullscreenchange', function () {
      if (fsElement() === wrap) {
        clearTimeout(liveTutorial.fsGuardTimer);
        watchFullscreenStage(wrap, video);
      } else if (liveTutorial.active) {
        liveTutorial.active = false;
        onFsExit();
      }
    });

    cta.addEventListener('click', function () {
      sendEvent('tutorial_fs_click');
      try { video.play().catch(function () {}); } catch (_) {}
      liveTutorial.active = true;
      var failedNow = false;
      try {
        // ALWAYS fullscreen the wrapper — the HUD and the warp canvas
        // both mount into fullscreenElement, never the bare video.
        var req = wrap.requestFullscreen
          ? wrap.requestFullscreen()
          : wrap.webkitRequestFullscreen
            ? wrap.webkitRequestFullscreen()
            : null;
        if (req && typeof req.catch === 'function') {
          req.catch(function () {
            failedNow = true;
            tutorialFail('fs_denied');
          });
        }
        if (!wrap.requestFullscreen && !wrap.webkitRequestFullscreen) {
          failedNow = true;
          tutorialFail('fs_denied');
        }
      } catch (_) {
        failedNow = true;
        tutorialFail('fs_denied');
      }
      // Belt-and-braces: no fullscreen within 2 s of the click → denied.
      liveTutorial.fsGuardTimer = setTimeout(function () {
        if (!fsElement() && !failedNow && !state.tutorialFailed) {
          tutorialFail('fs_denied');
        }
      }, 2000);
    });
  }

  /** Progressive disclosure: the YouTube handoff / Pro strip / trust footer
   *  stay hidden until the stage has done its job (aha), can't run
   *  (fallback), or the visitor explicitly skips. One screen, one action. */
  function revealAfter(scroll) {
    var after = $('uw-after');
    if (!after || !after.hidden) return;
    after.hidden = false;
    if (scroll) {
      try {
        var handoff = $('uw-handoff');
        if (handoff) handoff.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (_) {}
    }
  }

  var STORE_URLS = {
    chrome: 'https://chromewebstore.google.com/detail/ultrawider-%E2%80%94-fill-ultrawi/fpbkljincbjlmfefgcefcbjjppehkamo',
    edge: 'https://microsoftedge.microsoft.com/addons/detail/ultrawider-%E2%80%94-fill-ultrawi/mpjkkafkfjgealcigbiigiaeljokclkg',
    firefox: 'https://addons.mozilla.org/firefox/addon/ultrawider-21-9-video-fill/',
  };

  function showFallbackCard() {
    var live = $('live-stage');
    var grant = $('grant-card');
    var fb = $('fallback-card');
    if (live) live.hidden = true;
    if (grant) grant.hidden = true;
    if (fb) fb.hidden = false;
    // Store-first block: no extension visible → send them to install.
    var store = $('fallback-store-link');
    if (store && STORE_URLS[state.browser]) store.href = STORE_URLS[state.browser];
    var reload = $('fallback-reload');
    if (reload && !reload.dataset.wired) {
      reload.dataset.wired = '1';
      reload.addEventListener('click', function () { location.reload(); });
    }
    // The fallback's own instructions end at "open YouTube" — show the way.
    revealAfter(false);
  }

  // ─── Stage renderer (A2 slot) ───────────────────────────────────────
  var grantPoll = null;
  var grantShownSent = false;

  function renderStage() {
    if (state.flow === 'uw_grant_needed') {
      var grant = $('grant-card');
      if (grant) grant.hidden = false;
      moveSimTo('grant-sim-slot', 'SIMULATION');
      if (!grantShownSent) {
        grantShownSent = true;
        sendEvent('ff_grant_shown');
      }
      // Keep polling — the visitor can grant without reloading.
      if (!grantPoll) {
        grantPoll = setInterval(function () {
          if (readHandshake()) {
            clearInterval(grantPoll);
            grantPoll = null;
            sendEvent('ff_grant_completed', { ms_since_load: Date.now() - state.loadTs });
            state.flow = 'uw_live';
            state.fallbackReason = null;
            state.handshakeOk = true;
            if (grant) grant.hidden = true;
            renderFlow(); // full uw_live shell (headline copy + live stage)
          }
        }, 1000);
      }
      return;
    }

    if (state.flow === 'uw_live') {
      if (state.fallbackReason === 'no_handshake') {
        showFallbackCard();
        return;
      }
      whenConfig(function (liveOk) {
        // Only trust the live path while it's still the current plan —
        // a user override to std_16x9 may have landed meanwhile.
        if (state.flow !== 'uw_live') return;
        if (liveOk) {
          // Marketing intro first (sell → then teach): the tutorial stage
          // appears when the visitor clicks "Try it". introSeen survives
          // re-renders (monitor override round-trips) within the session.
          if (state.introSeen) {
            setupLiveStage();
          } else {
            showIntro();
          }
        } else {
          showFallbackCard();
        }
      });
    }
  }

  // ─── Marketing intro (uw_live) — what just landed + why it beats the
  //     dumb stretch. The shared sim gives the living stretch-vs-Smoothie
  //     proof right under the points; "Try it" swaps intro → live stage.
  var introWired = false;
  function showIntro() {
    var intro = $('uw-intro');
    if (!intro) { setupLiveStage(); return; } // markup missing → old path
    var stage = $('live-stage');
    if (stage) stage.hidden = true;
    // The page headline ("One more click — it's on the video below")
    // narrates the STAGE; the intro carries its own title.
    var hl = $('wl-headline');
    if (hl) hl.hidden = true;
    intro.hidden = false;
    moveSimTo('uw-intro-sim-slot', 'LIVE SIMULATION');
    sendEvent('intro_view');
    if (!introWired) {
      introWired = true;
      var btn = $('uw-intro-try');
      if (btn) {
        btn.addEventListener('click', function () {
          state.introSeen = true;
          intro.hidden = true;
          if (hl) hl.hidden = false;
          sendEvent('intro_try_clicked');
          // Park the sim again (hidden) — the stage is the hero now.
          moveSimTo('sim-park');
          setupLiveStage();
          var st = $('live-stage');
          if (st && typeof st.scrollIntoView === 'function') {
            st.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
      }
    }
  }

  // ─── Flow renderer ──────────────────────────────────────────────────
  var wiredUwSections = false;
  var wiredStdSections = false;
  var wiredNoextSections = false;

  function renderFlow() {
    var booting = $('wl-booting');
    if (booting) booting.hidden = true;

    renderHeadline();
    mountStatusbar();
    updateStatus();

    var flowUw = $('flow-uw');
    var flowStd = $('flow-std');
    var flowNoext = $('flow-noext');
    if (flowUw) flowUw.hidden = true;
    if (flowStd) flowStd.hidden = true;
    if (flowNoext) flowNoext.hidden = true;

    if (state.flow === 'uw_no_ext') {
      if (flowNoext) flowNoext.hidden = false;
      moveSimTo('noext-sim-slot', 'SIMULATION');
      wireNoextSections();
      return;
    }

    if (state.flow === 'std_16x9') {
      if (flowStd) flowStd.hidden = false;
      wireStdSections();
      return;
    }

    // uw_live / uw_grant_needed share the ultrawide flow shell.
    if (flowUw) flowUw.hidden = false;
    wireUwSections();
    renderStage();
  }

  function wireUwSections() {
    if (wiredUwSections) return;
    wiredUwSections = true;
    // brief_view now = the stage hint entering view (the 3-card pre-brief
    // was folded into one line under the stage — page opens ON the action).
    onceVisible($('wl-stage-hint'), function () { sendEvent('brief_view'); });
    onceVisible($('uw-pro'), function () { sendEvent('pro_panel_view'); });
    var skip = $('uw-skip');
    if (skip) {
      skip.addEventListener('click', function () {
        skip.hidden = true;
        revealAfter(true);
      });
    }
    var yt = $('yt-handoff-btn');
    if (yt) {
      yt.addEventListener('click', function () {
        sendEvent('yt_handoff_click', {
          ms_since_aha: state.ahaTs ? Date.now() - state.ahaTs : null,
        });
      });
    }
    var pricing = $('pricing-link');
    if (pricing) {
      pricing.addEventListener('click', function () { sendEvent('pricing_click'); });
    }
    var rescue = $('rescue-details');
    if (rescue) {
      var rescueSent = false;
      rescue.addEventListener('toggle', function () {
        if (rescue.open && !rescueSent) {
          rescueSent = true;
          sendEvent('rescue_open');
        }
      });
    }
    var rescueMail = $('rescue-mail');
    if (rescueMail) {
      rescueMail.href = 'mailto:' + CONTACT + '?subject=Popup%20didn%27t%20appear';
      rescueMail.textContent = CONTACT;
    }
  }

  function uninstallStepsFor(browser) {
    if (browser === 'firefox') {
      return [
        'Menu ≡ → <strong>Add-ons and themes</strong> (or press Ctrl+Shift+A).',
        'Find <strong>Ultrawider</strong> in the Extensions list.',
        'Click <strong>⋯ → Remove</strong>. Done — nothing left behind.',
      ];
    }
    if (browser === 'edge') {
      return [
        'Click the <strong>puzzle-piece icon</strong> in the toolbar.',
        'Click <strong>⋯</strong> next to Ultrawider.',
        'Choose <strong>“Remove from Microsoft Edge”</strong>. Done — nothing left behind.',
      ];
    }
    return [
      'Click the <strong>puzzle-piece icon</strong> in the toolbar.',
      'Click <strong>⋮</strong> next to Ultrawider.',
      'Choose <strong>“Remove from Chrome…”</strong>. Done — nothing left behind.',
    ];
  }

  function wireStdSections() {
    if (wiredStdSections) return;
    wiredStdSections = true;

    // Card 1 — micro-survey → honest exit (thanks + uninstall details)
    var survey = $('std-survey');
    var done = $('std-survey-done');
    if (survey && done) {
      var answered = false;
      var reasonBtns = survey.querySelectorAll('[data-reason]');
      for (var i = 0; i < reasonBtns.length; i++) {
        (function (btn) {
          btn.addEventListener('click', function () {
            if (answered) return;
            answered = true;
            sendEvent('install_reason', { answer: btn.getAttribute('data-reason') });
            survey.hidden = true;
            done.hidden = false;
            sendEvent('uninstall_info_view');
          });
        })(reasonBtns[i]);
      }
    }
    var steps = $('uninstall-steps');
    if (steps) {
      var list = uninstallStepsFor(state.browser);
      var html = '';
      for (var s = 0; s < list.length; s++) html += '<li>' + list[s] + '</li>';
      steps.innerHTML = html;
    }
    var fb = $('feedback-mail');
    if (fb) {
      fb.href = 'mailto:' + CONTACT + '?subject=Your%2016%3A9%20copy%20misled%20me';
      fb.addEventListener('click', function () { sendEvent('feedback_click'); });
    }

    // Card 2 — the personal share link. The ?r= tag ties landing visits back
    // to THIS installer (audience-stats stores it as utm_source), so we can
    // see both halves: link_copied here, and the visit it produced later.
    var refCode = 'w-' + String(state.iid || 'welcome').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toLowerCase();
    var shareUrl = LANDING_URL + '?r=' + refCode;
    var chip = $('share-url-chip');
    if (chip) chip.textContent = shareUrl.replace(/^https?:\/\//, '');
    var copyBtn = $('copy-link-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var ok = false;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(shareUrl).catch(function () {});
            ok = true;
          }
        } catch (_) {}
        if (!ok) {
          try {
            var ta = document.createElement('textarea');
            ta.value = shareUrl;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          } catch (_) {}
        }
        var label = $('copy-link-label');
        if (label) label.textContent = 'Copied ✓';
        copyBtn.classList.add('is-copied');
        sendEvent('link_copied', { ref: refCode });
      });
    }
  }

  function wireNoextSections() {
    if (wiredNoextSections) return;
    wiredNoextSections = true;
    // Browser-aware install row — same pattern as the landing hero.
    var store = state.browser;
    var cta = $('noext-install-cta');
    if (cta && STORE_URLS[store]) cta.setAttribute('href', STORE_URLS[store]);
    var current = document.querySelector('#flow-noext .store-links a[data-store="' + store + '"]');
    if (current) current.classList.add('is-current');
  }

  // ─── Manual override + monitor-move re-detection ────────────────────
  function uwTargetFlow() {
    if (state.handshakeOk || readHandshake()) return { flow: 'uw_live', fallback: null };
    if (state.browser === 'firefox') return { flow: 'uw_grant_needed', fallback: null };
    return { flow: 'uw_live', fallback: 'no_handshake' };
  }

  /** Apply a branch. `push` records it in browser history so the Back
   *  button undoes the toggle (it used to dead-end the visitor). */
  function applyBranch(toKind, method, push) {
    var from = state.flow;
    if (toKind === 'std_16x9') {
      if (state.flow === 'std_16x9') return;
      state.flow = 'std_16x9';
      state.fallbackReason = null;
    } else {
      if (state.flow !== 'std_16x9') return;
      var t = uwTargetFlow();
      state.flow = t.flow;
      state.fallbackReason = t.fallback;
    }
    sendEvent('profile_override', { from: from, to: state.flow, method: method });
    if (push) {
      try { history.pushState({ uwFlow: state.flow }, '', location.pathname + location.hash); } catch (_) {}
    }
    renderFlow();
  }

  function switchBranch(method) {
    applyBranch(state.flow === 'std_16x9' ? 'uw' : 'std_16x9', method, true);
  }

  function wireOverride() {
    var link = $('wl-override');
    if (link) link.addEventListener('click', function () { switchBranch('link'); });
    window.addEventListener('popstate', function (e) {
      var to = e.state && e.state.uwFlow;
      if (!to || to === state.flow) return;
      applyBranch(to === 'std_16x9' ? 'std_16x9' : 'uw', 'history', false);
    });
  }

  var toastEl = null;
  function hideToast() {
    if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
    toastEl = null;
  }
  function offerSwitch(nowUw) {
    if (toastEl) return;
    toastEl = document.createElement('div');
    toastEl.className = 'wl-toast';
    toastEl.setAttribute('role', 'status');
    var span = document.createElement('span');
    span.textContent = nowUw
      ? 'This looks like an ultrawide screen now — switch to the live guide?'
      : 'This looks like a 16:9 screen now — switch the guide?';
    var yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'wl-toast-switch';
    yes.textContent = 'Switch';
    yes.addEventListener('click', function () {
      hideToast();
      switchBranch('drag');
    });
    var no = document.createElement('button');
    no.type = 'button';
    no.className = 'wl-toast-dismiss';
    no.textContent = 'Keep';
    no.addEventListener('click', hideToast);
    toastEl.appendChild(span);
    toastEl.appendChild(yes);
    toastEl.appendChild(no);
    document.body.appendChild(toastEl);
  }

  function wireRedetect() {
    var timer = null;
    function recheck() {
      var d = detectDims();
      if (d.w === state.dims.w && d.h === state.dims.h) return;
      state.dims = d;
      updateStatus();
      if (!state.flow || state.flow === 'uw_no_ext') return;
      var nowUw = isUltrawide(d.w, d.h);
      var flowIsUw = state.flow !== 'std_16x9';
      if (nowUw !== flowIsUw) offerSwitch(nowUw);
    }
    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(recheck, 400);
    }
    // There is no cross-browser "window moved" event — resize fires on
    // monitor moves that change DPR/dimensions, focus catches the rest.
    window.addEventListener('resize', schedule);
    window.addEventListener('focus', schedule);
  }

  // ─── Boot ───────────────────────────────────────────────────────────
  function boot() {
    state.dims = detectDims();
    updateStatus();
    wireOverride();
    wireRedetect();
    wireSimEngagement();

    sendEvent('welcome_view');
    fetchConfig(); // kill-switch — resolves in parallel, ≤2.5 s

    var hwReady = null;
    var handshakeResult = null;

    function maybeFinish() {
      if (!hwReady || !handshakeResult) return;
      state.handshakeOk = handshakeResult.ok;
      sendEvent('ext_handshake', {
        ok: handshakeResult.ok,
        latency_ms: handshakeResult.latency_ms,
      });
      assignFlow(handshakeResult.ok);

      if (!state.helloSent) {
        state.helloSent = true;
        postJSON('/api/welcome/hello', {
          install_id: state.iid,
          version: state.version,
          browser: state.browser,
          lang: hwReady.lang,
          screen_w: hwReady.screen_w,
          screen_h: hwReady.screen_h,
          dpr: hwReady.dpr,
          aspect_tier: hwReady.aspect_tier,
          hw_cores: hwReady.hw_cores,
          hw_memory_gb: hwReady.hw_memory_gb,
          gpu: hwReady.gpu,
          refresh_hz: hwReady.refresh_hz,
          dev_build: state.devBuild,
          internal: state.internal,
          flow: state.flow,
          source: state.source,
        });
      }

      var assigned = { flow: state.flow };
      if (state.fallbackReason) assigned.fallback_reason = state.fallbackReason;
      sendEvent('flow_assigned', assigned);

      // Seed history with the assigned branch so Back after a manual
      // override returns HERE instead of leaving the page.
      try { history.replaceState({ uwFlow: state.flow }, '', location.pathname + location.hash); } catch (_) {}

      renderFlow();
    }

    collectHardware(function (hw) {
      hwReady = hw;
      maybeFinish();
    });
    pollHandshake(function (res) {
      handshakeResult = res;
      maybeFinish();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
