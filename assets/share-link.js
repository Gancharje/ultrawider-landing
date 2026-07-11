/**
 * Personal share link on the landing.
 *
 * Every visitor gets a stable ref code:
 *   w-<8> — extension installed (/welcome persisted _uw_iid), same code
 *           the welcome page hands out, so both surfaces agree;
 *   v-<8> — anonymous visitor, minted once into localStorage._uw_vid.
 *
 * The code travels as ?r= which audience-stats already records as
 * utm_source on every visit — so "copied → someone opened it" joins in
 * the backend with zero extra endpoints. Every copy beacons
 * /api/landing-click {target:'share-copy', share_ref} + a Metrika goal.
 *
 * Two surfaces:
 *   #share      — standing section after the playground (always on).
 *   #hero-share — contextual hero swap:
 *       16:9 visitor   → replaces BOTH hero CTAs. They can't use the
 *                        product on this screen; passing the link on
 *                        (or opening it on their ultrawide machine) IS
 *                        their conversion. Store links stay below.
 *       ext installed  → replaces the Install button only (detected via
 *                        the extension's own <html data-ultrawider-version>
 *                        handshake stamp, icon-probe cache as fallback).
 *       uw, no ext     → hero untouched (Install stays primary).
 */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var ULTRAWIDER = window.ULTRAWIDER || {};
  var API_BASE = ULTRAWIDER.API_BASE || 'https://api.ultrawider.net';

  // ── ref code (unambiguous alphabet — people retype these) ─────────
  function rand8() {
    var a = 'abcdefghjkmnpqrstuvwxyz23456789';
    var s = '';
    var buf = null;
    try {
      buf = new Uint8Array(8);
      (window.crypto || window.msCrypto).getRandomValues(buf);
    } catch (_) { /* fall through to Math.random */ }
    for (var i = 0; i < 8; i++) {
      var n = buf ? buf[i] % a.length : Math.floor(Math.random() * a.length);
      s += a[n];
    }
    return s;
  }

  function refCode() {
    try {
      var iid = localStorage.getItem('_uw_iid');
      if (iid) {
        var c = iid.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
        if (c.length === 8) return 'w-' + c;
      }
      var vid = localStorage.getItem('_uw_vid');
      if (!vid || !/^[a-z2-9]{8}$/.test(vid)) {
        vid = rand8();
        localStorage.setItem('_uw_vid', vid);
      }
      return 'v-' + vid;
    } catch (_) { return null; /* localStorage blocked → untracked link */ }
  }

  function screenRatio() {
    // Same dims heuristic as the hero-personalization inline script:
    // a viewport dramatically narrower than the screen means DevTools
    // emulation or a snapped window — trust the viewport then, so the
    // hero copy and this swap never disagree about the visitor's screen.
    var sw = (window.screen && window.screen.width) || 0;
    var sh = (window.screen && window.screen.height) || 0;
    var iw = window.innerWidth || 0;
    var ih = window.innerHeight || 0;
    var w = sw, h = sh;
    if (sw && iw && iw < sw * 0.85) { w = iw; h = ih; }
    if (!w) { w = iw; h = ih; }
    return w && h ? w / h : 0;
  }

  // ── extension presence ─────────────────────────────────────────────
  // Primary: the content script stamps <html data-ultrawider-version>
  // on our own host (all browsers, incl. Firefox once permission is
  // granted). It can land a beat after us — poll briefly. Fallback:
  // audience-stats' icon-probe session cache (Chromium only).
  function detectExtension(cb) {
    function stamped() {
      return !!document.documentElement.getAttribute('data-ultrawider-version');
    }
    if (stamped()) { cb(true); return; }
    var tries = 0;
    var timer = setInterval(function () {
      if (stamped()) { clearInterval(timer); cb(true); return; }
      if (++tries >= 8) {
        clearInterval(timer);
        var flag = null;
        try { flag = sessionStorage.getItem('_uw_ext'); } catch (_) {}
        cb(flag === '1');
      }
    }, 250);
  }

  // ── copy engine (shared by both surfaces) ──────────────────────────
  function beacon(ref) {
    var src = '';
    var refHost = '';
    var internalFlag = false;
    var installId = null;
    try {
      src = sessionStorage.getItem('_uw_src') || '';
      refHost = sessionStorage.getItem('_uw_ref') || document.referrer || '';
    } catch (_) { refHost = document.referrer || ''; }
    try {
      installId = localStorage.getItem('_uw_iid') || null;
      internalFlag = localStorage.getItem('_uw_internal') === '1';
    } catch (_) {}
    try {
      fetch(API_BASE + '/api/landing-click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'share-copy',
          share_ref: ref,
          referrer: refHost,
          utm_source: src,
          landing_path: location.pathname || '/',
          install_id: installId,
          internal: internalFlag,
        }),
        keepalive: true,
        mode: 'cors',
        credentials: 'omit',
      }).catch(function () {});
    } catch (_) {}
    try {
      if (window.UW_METRIKA) window.UW_METRIKA.goal('share_copied');
    } catch (_) {}
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
    return ok;
  }

  function wireCopy(chipId, btnId, labelId, shareUrl, ref) {
    var chip = document.getElementById(chipId);
    var btn = document.getElementById(btnId);
    var label = document.getElementById(labelId);
    if (!chip || !btn) return;
    chip.textContent = shareUrl.replace('https://', '');
    var confirmTimer = null;
    function confirmCopied() {
      if (!label) return;
      label.textContent = 'Copied!';
      btn.classList.add('share-copied');
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(function () {
        label.textContent = 'Copy link';
        btn.classList.remove('share-copied');
      }, 2200);
    }
    btn.addEventListener('click', function () {
      var done = function () { confirmCopied(); beacon(ref); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareUrl).then(done, function () {
          if (legacyCopy(shareUrl)) done();
        });
      } else if (legacyCopy(shareUrl)) {
        done();
      }
    });
  }

  function init() {
    var ref = refCode();
    var shareUrl = 'https://ultrawider.net/' + (ref ? '?r=' + ref : '');
    var isStd = (function () { var r = screenRatio(); return r > 0 && r < 2.1; })();

    // 1) Standing #share section after the playground.
    wireCopy('share-chip', 'share-copy', 'share-copy-label', shareUrl, ref);
    if (isStd) {
      var title = document.getElementById('share-title');
      var sub = document.getElementById('share-sub');
      if (title) title.textContent = 'Your screen is 16:9 — pass it on.';
      if (sub) {
        sub.textContent =
          'Ultrawider shines on 21:9 and wider. Know someone with an ' +
          'ultrawide? Send them your personal link — we’ll see when it lands.';
      }
    }

    // 2) Contextual hero swap.
    var heroShare = document.getElementById('hero-share');
    var note = document.getElementById('hero-share-note');
    if (!heroShare) return;
    wireCopy('hero-share-chip', 'hero-share-copy', 'hero-share-copy-label', shareUrl, ref);

    function showHeroShare(noteText) {
      if (note) note.textContent = noteText;
      heroShare.hidden = false;
    }

    if (isStd) {
      // 16:9: both CTAs step aside — the link IS the action here.
      var actions = document.querySelector('.aaa-actions');
      if (actions) actions.hidden = true;
      showHeroShare(
        'Your screen is 16:9 — Ultrawider needs an ultrawide. Send this ' +
        'to someone who has one, or open your link on your ultrawide ' +
        'machine. It’s personal, so we’ll see when it lands.'
      );
      return;
    }

    detectExtension(function (hasExt) {
      if (!hasExt) return; // ultrawide, no extension → default hero.
      var install = document.getElementById('install-cta');
      if (install) install.hidden = true;
      showHeroShare(
        'Already installed on this browser ✓ — pass your link to another ' +
        'ultrawide owner, or grab it from the store links below for ' +
        'another browser.'
      );
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
