/**
 * Яндекс.Метрика — счётчик ultrawider.net (ID 109480276).
 *
 * Опции по умолчанию:
 *   - ssr:true                  — точный учёт server-rendered pages
 *   - webvisor:true             — записи сессий + heatmaps
 *   - clickmap:true             — карта кликов
 *   - ecommerce:'dataLayer'     — события покупок через window.dataLayer
 *   - accurateTrackBounce:true  — bounce только если меньше 15 сек
 *   - trackLinks:true           — клики на внешние ссылки
 *
 * Расширение НЕ грузит Метрику — Chrome Web Store policy.
 * Метрика работает только на сайте.
 *
 * Цели для отчётов задаются ТОЛЬКО внутри панели Метрики
 * (Настройка → Цели). В коде их потом дёргать так:
 *   window.UW_METRIKA.goal('cta_click')          // клик по Get Pro
 *   window.UW_METRIKA.goal('checkout_submit')    // отправка checkout
 *   window.UW_METRIKA.goal('install_extension')  // переход в Web Store
 */
(function () {
  var UW_METRIKA_COUNTER_ID = 109480276;

  (function (m, e, t, r, i, k, a) {
    m[i] = m[i] || function () {
      (m[i].a = m[i].a || []).push(arguments);
    };
    m[i].l = 1 * new Date();
    for (var j = 0; j < document.scripts.length; j++) {
      if (document.scripts[j].src === r) return;
    }
    k = e.createElement(t);
    a = e.getElementsByTagName(t)[0];
    k.async = 1;
    k.src = r;
    a.parentNode.insertBefore(k, a);
  })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js?id=' + UW_METRIKA_COUNTER_ID, 'ym');

  window.ym(UW_METRIKA_COUNTER_ID, 'init', {
    ssr: true,
    webvisor: true,
    clickmap: true,
    ecommerce: 'dataLayer',
    referrer: document.referrer,
    url: location.href,
    accurateTrackBounce: true,
    trackLinks: true,
  });

  window.UW_METRIKA = {
    goal: function (name, params) {
      try { window.ym(UW_METRIKA_COUNTER_ID, 'reachGoal', name, params); }
      catch (_) {}
    },
    hit: function (url) {
      try { window.ym(UW_METRIKA_COUNTER_ID, 'hit', url); }
      catch (_) {}
    },
    userParams: function (params) {
      try { window.ym(UW_METRIKA_COUNTER_ID, 'userParams', params); }
      catch (_) {}
    },
  };
})();
