/*
 * Ultrawider — minimal language switcher
 *
 * Behaviour:
 *   1. On first visit (no cookie), check browser language. If it starts with
 *      "ru" and the user is on an EN page, redirect to the RU mirror.
 *   2. On every page, when the user clicks an EN/RU link, store the choice
 *      in a cookie so we don't auto-redirect again.
 *   3. If a cookie is set, never auto-redirect — the user's last manual
 *      choice wins.
 *
 * No dependencies. Runs after DOMContentLoaded (loaded with `defer`).
 */
(function () {
  var COOKIE_NAME = 'ultrawider_lang';
  var COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function setCookie(name, value) {
    document.cookie =
      name + '=' + encodeURIComponent(value) +
      '; path=/; max-age=' + COOKIE_MAX_AGE +
      '; SameSite=Lax';
  }

  function detectBrowserLang() {
    var lang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
    if (lang.indexOf('ru') === 0) return 'ru';
    return 'en';
  }

  function currentPageLang() {
    return location.pathname.indexOf('/ru/') === 0 ? 'ru' : 'en';
  }

  function ruMirrorOf(pathname) {
    // EN file at /foo.html  →  /ru/foo.html
    // EN root /             →  /ru/
    if (pathname === '/' || pathname === '') return '/ru/';
    if (pathname.indexOf('/ru/') === 0) return pathname; // already RU
    return '/ru' + pathname;
  }

  function enMirrorOf(pathname) {
    if (pathname.indexOf('/ru/') === 0) {
      var stripped = pathname.replace(/^\/ru\//, '/');
      return stripped === '/' ? '/' : stripped;
    }
    return pathname;
  }

  // 1. Auto-redirect on first visit
  var saved = getCookie(COOKIE_NAME);
  var pageLang = currentPageLang();

  if (!saved) {
    var preferred = detectBrowserLang();
    if (preferred === 'ru' && pageLang === 'en') {
      // Set cookie to "ru" before redirect so we don't loop
      setCookie(COOKIE_NAME, 'ru');
      location.replace(ruMirrorOf(location.pathname) + location.search + location.hash);
      return;
    }
  }

  // 2. Wire up explicit lang-switch clicks (any <a> inside .lang-switch)
  document.addEventListener('DOMContentLoaded', function () {
    var switches = document.querySelectorAll('.lang-switch a');
    Array.prototype.forEach.call(switches, function (a) {
      a.addEventListener('click', function () {
        var target = a.getAttribute('href') || '';
        var lang = target.indexOf('/ru') === 0 ? 'ru' : 'en';
        setCookie(COOKIE_NAME, lang);
      });
    });

    // Also wire footer language links
    var footerLangNav = document.querySelector('.footer-nav a[href="/ru/"], .footer-nav a[href="/"]');
    var footerLangLinks = document.querySelectorAll('.footer-nav a[href="/ru/"], .footer-nav a[href="/"]');
    Array.prototype.forEach.call(footerLangLinks, function (a) {
      a.addEventListener('click', function () {
        var target = a.getAttribute('href') || '';
        var lang = target.indexOf('/ru') === 0 ? 'ru' : 'en';
        setCookie(COOKIE_NAME, lang);
      });
    });
  });
})();
