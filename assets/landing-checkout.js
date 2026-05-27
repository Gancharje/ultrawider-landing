/**
 * Landing-page pricing + inline checkout.
 *
 * Renders 4 sponsorship cards inside [data-landing-plans], then handles
 * the click-to-expand inline checkout flow without a page navigation:
 *
 *   1. Visitor clicks "Sponsor monthly/yearly/etc"
 *   2. Inline checkout panel slides into view BELOW the cards with the
 *      selected plan's summary + an email input
 *   3. Submit → POST /api/checkout → redirect to /order?id=<order_id>
 *      (the order page handles payment polling + license display)
 *
 * Reads live prices from /api/pricing if reachable; falls back to
 * window.ULTRAWIDER.PLANS cold-load defaults otherwise.
 */
(function () {
  'use strict';

  var ORDER = ['monthly', 'quarterly', 'yearly', 'lifetime'];
  var RECOMMENDED = 'yearly';

  // Tightened to 2 distinct features per card; trust items ("cancel
  // anytime", "14-day refund") live in the section-wide fine-print
  // line below the grid — no need to repeat per card.
  var EXTRAS = {
    monthly: {
      period: '/mo',
      tagline: 'Try Pro for a month',
      features: [
        'Twitch, Vimeo, Kick + most other video sites',
        'Aspect-aware auto-tuning',
      ],
      cta: 'Sponsor monthly',
    },
    quarterly: {
      period: '',
      tagline: 'Three months at a discount',
      features: [
        'Everything in Monthly',
        'Save 11% vs monthly',
      ],
      cta: 'Sponsor 3 months',
    },
    yearly: {
      period: '/yr',
      tagline: 'The way most people sponsor',
      features: [
        'Everything in Quarterly',
        'Save ~35% vs monthly',
      ],
      cta: 'Sponsor yearly',
    },
    lifetime: {
      period: '',
      tagline: 'Pay once. Forever.',
      features: [
        'Everything in Yearly',
        'All future updates included',
      ],
      cta: 'Sponsor lifetime',
    },
  };

  function effectivePerMonth(planId, p) {
    if (planId === 'quarterly') return '≈ $' + (p.priceUsd / 3).toFixed(2) + '/mo';
    if (planId === 'yearly')    return '≈ $' + (p.priceUsd / 12).toFixed(2) + '/mo';
    return '';
  }

  // Format priceUsd as "$23" + ".84" (sub-sized cents) so the integer
  // dominates the visual at a glance — Apple-style price layout.
  function formatPriceParts(priceUsd) {
    var s = priceUsd.toFixed(2);
    var dot = s.indexOf('.');
    return { integer: s.slice(0, dot), cents: s.slice(dot) }; // ".84"
  }

  function planCard(planId, plans, idx) {
    var p = plans[planId];
    if (!p) return '';
    var ex = EXTRAS[planId] || { period: '', features: [], cta: 'Sponsor' };
    var isRec = planId === RECOMMENDED;
    var price = formatPriceParts(p.priceUsd);

    var html = '<div class="lp-card' + (isRec ? ' lp-card--featured' : '') +
      '" data-plan="' + planId + '" style="animation-delay:' + (idx * 80) + 'ms">';

    if (isRec) html += '<div class="lp-ribbon">Most popular</div>';

    html += '<span class="lp-card-eyebrow">' + p.label + '</span>';
    html += '<p class="lp-card-tagline">' + ex.tagline + '</p>';

    html += '<div class="lp-card-stars"><span aria-hidden="true">⭐</span> ' +
            p.starsAmount.toLocaleString() + ' Stars</div>';

    html += '<div class="lp-card-price">';
    html += '<span class="lp-card-price-approx" aria-hidden="true">≈</span>';
    html += '<span class="lp-card-price-currency">$</span>';
    html += '<span class="lp-card-price-int">' + price.integer + '</span>';
    html += '<span class="lp-card-price-cents">' + price.cents + '</span>';
    if (ex.period) html += '<span class="lp-card-price-per">' + ex.period + '</span>';
    html += '</div>';

    var eff = effectivePerMonth(planId, p);
    if (eff) {
      html += '<p class="lp-card-equiv">' + eff + '</p>';
    } else {
      html += '<p class="lp-card-equiv lp-card-equiv--placeholder">&nbsp;</p>';
    }

    html += '<p class="lp-card-duration">License active ' + p.duration + '</p>';

    html += '<ul class="lp-card-features">';
    for (var i = 0; i < ex.features.length; i++) {
      html += '<li>' + ex.features[i] + '</li>';
    }
    html += '</ul>';

    html += '<button type="button" class="lp-card-cta" data-select="' + planId + '">' + ex.cta + '</button>';
    html += '</div>';
    return html;
  }

  function init() {
    var root = document.getElementById('landing-plans');
    if (!root) return;
    var plans = (window.ULTRAWIDER && window.ULTRAWIDER.PLANS) || null;
    if (!plans) {
      console.warn('landing-checkout: window.ULTRAWIDER.PLANS missing');
      return;
    }

    var checkout = document.getElementById('landing-checkout');
    var summary  = document.getElementById('landing-checkout-summary');
    var form     = document.getElementById('landing-checkout-form');
    var submit   = document.getElementById('landing-checkout-submit');
    var errBox   = document.getElementById('landing-checkout-error');
    var emailIn  = document.getElementById('landing-email');
    var closeBtn = document.getElementById('landing-checkout-close');

    function render() {
      root.innerHTML = ORDER.map(function (id, i) { return planCard(id, plans, i); }).join('');
    }
    render();

    // Refresh from /api/pricing — overrides config.js defaults if available.
    var api = window.ULTRAWIDER && window.ULTRAWIDER.API_BASE;
    if (api && typeof fetch === 'function') {
      fetch(api + '/api/pricing', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data || !data.plans) return;
          var changed = false;
          Object.keys(data.plans).forEach(function (k) {
            var live = data.plans[k];
            var cur = plans[k];
            if (!cur || !live) return;
            if (typeof live.priceUsd === 'number') { cur.priceUsd = live.priceUsd; changed = true; }
            if (typeof live.starsAmount === 'number') { cur.starsAmount = live.starsAmount; changed = true; }
          });
          if (changed) render();
        })
        .catch(function () { /* keep defaults */ });
    }

    var selectedPlan = null;

    function openCheckout(planId) {
      var p = plans[planId];
      if (!p) return;
      selectedPlan = planId;
      summary.innerHTML =
        '<div class="landing-checkout-summary-top">' +
          '<span class="landing-checkout-summary-label">' + p.label + ' sponsorship</span>' +
          '<span class="landing-checkout-summary-price">' +
            '<span class="landing-checkout-summary-stars">⭐ ' + p.starsAmount + ' Stars</span>' +
            '<span class="landing-checkout-summary-usd">≈ $' + p.priceUsd.toFixed(2) + '</span>' +
          '</span>' +
        '</div>' +
        '<p class="landing-checkout-summary-dur">License active ' + p.duration + '</p>';
      errBox.hidden = true;
      checkout.hidden = false;
      // Highlight selected card
      root.querySelectorAll('.lp-card').forEach(function (el) {
        el.classList.toggle('lp-card--selected', el.getAttribute('data-plan') === planId);
      });
      // Smooth-scroll into view and focus email field
      setTimeout(function () {
        checkout.scrollIntoView({ behavior: 'smooth', block: 'center' });
        try { emailIn.focus({ preventScroll: true }); } catch (_e) { emailIn.focus(); }
      }, 60);
    }

    function closeCheckout() {
      checkout.hidden = true;
      selectedPlan = null;
      root.querySelectorAll('.lp-card--selected').forEach(function (el) {
        el.classList.remove('lp-card--selected');
      });
    }

    function showError(msg) {
      errBox.textContent = msg;
      errBox.hidden = false;
      submit.disabled = false;
      submit.textContent = 'Continue to payment →';
    }

    root.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-select]');
      if (!btn) return;
      openCheckout(btn.getAttribute('data-select'));
    });

    if (closeBtn) closeBtn.addEventListener('click', closeCheckout);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!selectedPlan) return;
      var email = (emailIn.value || '').trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError('Please enter a valid email address.');
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Creating your order…';
      errBox.hidden = true;

      var installId = new URLSearchParams(location.search).get('install_id');

      fetch(api + '/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: selectedPlan,
          email: email,
          install_id: installId || undefined,
        }),
      })
        .then(function (resp) {
          if (!resp.ok) {
            return resp.json().catch(function () { return {}; }).then(function (b) {
              throw new Error(b.message || 'server error (' + resp.status + ')');
            });
          }
          return resp.json();
        })
        .then(function (data) {
          try {
            sessionStorage.setItem('ultrawider_last_order', data.order_id);
            sessionStorage.setItem('ultrawider_order_url', '/order?id=' + data.order_id);
          } catch (_e) { /* private mode etc — ignore */ }
          location.assign(data.payment_url);
        })
        .catch(function (e) {
          var contact = (window.ULTRAWIDER && window.ULTRAWIDER.CONTACT_EMAIL) || 'hello@ultrawider.net';
          showError("Couldn't create order: " + e.message + '. Try again or email ' + contact);
        });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
