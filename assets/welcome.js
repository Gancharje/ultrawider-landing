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
 *      is fire-and-forget: sendBeacon first, fetch keepalive fallback,
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
  };

  try {
    state.iid = BOOT.iid || localStorage.getItem('_uw_iid') || null;
    state.internal =
      localStorage.getItem('_uw_internal') === '1' || BOOT.dev === '1';
  } catch (_) {
    state.iid = BOOT.iid || null;
    state.internal = BOOT.dev === '1';
  }

  // ─── Beacons — NEVER block or break UX ──────────────────────────────
  function postJSON(path, payload) {
    var url = API + path;
    var body;
    try {
      body = JSON.stringify(payload);
    } catch (_) {
      return;
    }
    // sendBeacon survives tab close and never blocks; some browsers
    // refuse application/json Blobs cross-origin, so fall through to
    // fetch keepalive whenever it declines or throws.
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(url, blob)) return;
      }
    } catch (_) { /* fall through */ }
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

  // ─── Shared shell ───────────────────────────────────────────────────
  function updateChip() {
    var chip = $('wl-chip');
    var text = $('wl-chip-text');
    if (!chip || !text) return;
    var d = state.dims;
    if (!d.w || !d.h) {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;
    text.innerHTML =
      'Detected: <strong>' + d.w + '×' + d.h + '</strong> — ' +
      tierLabel(d.w, d.h);
  }

  function renderHeadline() {
    var installed = $('wl-headline-installed');
    var noext = $('wl-headline-noext');
    var sub = $('wl-installed-sub');
    if (state.flow === 'uw_no_ext') {
      if (noext) noext.hidden = false;
      if (installed) installed.hidden = true;
      return;
    }
    if (installed) installed.hidden = false;
    if (noext) noext.hidden = true;
    if (sub) {
      if (state.flow === 'std_16x9') {
        sub.textContent =
          'Installed fine — but there’s something you should know about this screen.';
      } else if (state.flow === 'uw_grant_needed') {
        sub.textContent =
          'One Firefox permission and one click — let’s do both right now.';
      } else {
        sub.textContent =
          'One click and it’s working. Let’s do that click right now.';
      }
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
    setCaption(
      'That’s it. Your screen, filled. 🟠 Now let’s set <strong>YouTube</strong>.',
      { success: true, arrow: false }
    );
    var wrap = $('live-stage-screen');
    if (wrap) {
      wrap.addEventListener('click', exitFs, { once: true });
    }
    liveTutorial.successTimer = setTimeout(exitFs, 4000);
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
            // Smoothie start also hides the original video element.
            try {
              if (video.style && video.style.visibility === 'hidden') {
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
    var done = $('wl-stage-done');
    var cta = $('stage-fs-cta');
    if (state.ahaSeen) {
      if (done) done.hidden = false;
      if (cta) cta.hidden = true;
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

  function showFallbackCard() {
    var live = $('live-stage');
    var grant = $('grant-card');
    var fb = $('fallback-card');
    if (live) live.hidden = true;
    if (grant) grant.hidden = true;
    if (fb) fb.hidden = false;
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
          setupLiveStage();
        } else {
          showFallbackCard();
        }
      });
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
    updateChip();

    var flowUw = $('flow-uw');
    var flowStd = $('flow-std');
    var flowNoext = $('flow-noext');
    var override = $('wl-override');
    if (flowUw) flowUw.hidden = true;
    if (flowStd) flowStd.hidden = true;
    if (flowNoext) flowNoext.hidden = true;

    if (override) {
      override.hidden = state.flow === 'uw_no_ext';
      override.textContent =
        state.flow === 'std_16x9'
          ? 'Wrong monitor? My ultrawide is this one'
          : 'Wrong monitor? I’m on my other screen';
    }

    if (state.flow === 'uw_no_ext') {
      if (flowNoext) flowNoext.hidden = false;
      moveSimTo('noext-sim-slot', 'SIMULATION');
      wireNoextSections();
      return;
    }

    if (state.flow === 'std_16x9') {
      if (flowStd) flowStd.hidden = false;
      moveSimTo('std-sim-slot', 'SIMULATION — what ultrawide owners see');
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
    onceVisible($('uw-brief'), function () { sendEvent('brief_view'); });
    onceVisible($('uw-pro'), function () { sendEvent('pro_panel_view'); });
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

    // S2 · micro-survey
    var survey = $('std-survey');
    if (survey) {
      var answered = false;
      function answer(val) {
        if (answered) return;
        answered = true;
        sendEvent('install_reason', { answer: val });
        var thanks = $('std-survey-thanks');
        if (thanks) thanks.hidden = false;
        var btns = survey.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) btns[i].disabled = true;
        if (val === 'elsewhere') {
          // They own an ultrawide → surface "take it with you" above the sim.
          var take = $('std-take');
          var sim = $('std-sim');
          if (take && sim && sim.parentNode) {
            sim.parentNode.insertBefore(take, sim);
            try {
              take.scrollIntoView({
                behavior: reducedMotion ? 'auto' : 'smooth',
                block: 'center',
              });
            } catch (_) {}
          }
        }
      }
      var reasonBtns = survey.querySelectorAll('[data-reason]');
      for (var i = 0; i < reasonBtns.length; i++) {
        (function (btn) {
          btn.addEventListener('click', function () {
            answer(btn.getAttribute('data-reason'));
          });
        })(reasonBtns[i]);
      }
      var dismiss = survey.querySelector('[data-reason-dismiss]');
      if (dismiss) {
        dismiss.addEventListener('click', function () { answer('dismissed'); });
      }
    }

    // S4 · copy link + email form
    var copyBtn = $('copy-link-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var ok = false;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(WELCOME_URL).catch(function () {});
            ok = true;
          }
        } catch (_) {}
        if (!ok) {
          try {
            var ta = document.createElement('textarea');
            ta.value = WELCOME_URL;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          } catch (_) {}
        }
        copyBtn.classList.add('is-copied');
        copyBtn.lastChild.textContent = ' Copied ✓';
        sendEvent('link_copied');
      });
    }
    var emailForm = $('email-link-form');
    if (emailForm) {
      emailForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = $('email-link-input');
        var email = input ? String(input.value || '').trim() : '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          if (input) input.focus();
          return;
        }
        sendEvent('email_link_requested', { email: email });
        var msg = $('email-sent-msg');
        if (msg) msg.hidden = false; // optimistic — backend sends it later
        emailForm.reset();
      });
    }

    // S5 · uninstall steps + view/feedback events
    var steps = $('uninstall-steps');
    if (steps) {
      var list = uninstallStepsFor(state.browser);
      var html = '';
      for (var s = 0; s < list.length; s++) html += '<li>' + list[s] + '</li>';
      steps.innerHTML = html;
    }
    onceVisible($('std-goodbye'), function () { sendEvent('uninstall_info_view'); });
    var fb = $('feedback-mail');
    if (fb) {
      fb.href = 'mailto:' + CONTACT + '?subject=Your%2016%3A9%20copy%20misled%20me';
      fb.addEventListener('click', function () { sendEvent('feedback_click'); });
    }
  }

  function wireNoextSections() {
    if (wiredNoextSections) return;
    wiredNoextSections = true;
    // Browser-aware install row — same pattern as the landing hero.
    var STORES = {
      chrome: 'https://chromewebstore.google.com/detail/ultrawider-%E2%80%94-fill-ultrawi/fpbkljincbjlmfefgcefcbjjppehkamo',
      edge: 'https://microsoftedge.microsoft.com/addons/detail/ultrawider-%E2%80%94-fill-ultrawi/mpjkkafkfjgealcigbiigiaeljokclkg',
      firefox: 'https://addons.mozilla.org/firefox/addon/ultrawider-21-9-video-fill/',
    };
    var store = state.browser;
    var cta = $('noext-install-cta');
    if (cta && STORES[store]) cta.setAttribute('href', STORES[store]);
    var current = document.querySelector('#flow-noext .store-links a[data-store="' + store + '"]');
    if (current) current.classList.add('is-current');
  }

  // ─── Manual override + monitor-move re-detection ────────────────────
  function uwTargetFlow() {
    if (state.handshakeOk || readHandshake()) return { flow: 'uw_live', fallback: null };
    if (state.browser === 'firefox') return { flow: 'uw_grant_needed', fallback: null };
    return { flow: 'uw_live', fallback: 'no_handshake' };
  }

  function switchBranch(method) {
    var from = state.flow;
    var to;
    if (state.flow === 'std_16x9') {
      var t = uwTargetFlow();
      state.flow = t.flow;
      state.fallbackReason = t.fallback;
      to = t.flow;
    } else {
      state.flow = 'std_16x9';
      state.fallbackReason = null;
      to = 'std_16x9';
    }
    sendEvent('profile_override', { from: from, to: to, method: method });
    renderFlow();
  }

  function wireOverride() {
    var link = $('wl-override');
    if (!link) return;
    link.addEventListener('click', function () { switchBranch('link'); });
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
      updateChip();
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
    updateChip();
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
        });
      }

      var assigned = { flow: state.flow };
      if (state.fallbackReason) assigned.fallback_reason = state.fallbackReason;
      sendEvent('flow_assigned', assigned);

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
