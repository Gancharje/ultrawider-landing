/**
 * Landing-page pricing + inline checkout.
 *
 * Renders the sponsorship cards inside [data-landing-plans], then handles
 * the click-to-expand inline checkout flow without a page navigation:
 *
 *   1. Visitor clicks "Sponsor monthly/yearly"
 *   2. Inline checkout panel slides into view BELOW the cards with the
 *      selected plan's summary + an email input
 *   3. Submit → POST /api/checkout/lava → redirect straight to Lava.top's
 *      branded card / PayPal checkout page (data.payment_url)
 *
 * Prices come from window.ULTRAWIDER.PLANS (static, authoritative).
 */
(function () {
  'use strict';

  var ORDER = ['monthly', 'yearly', 'lifetime'];
  var RECOMMENDED = 'yearly';

  // Funnel goals — metrika.js (deferred, earlier in head) defines
  // UW_METRIKA before our init runs; guard anyway so an exotic load
  // order can't break checkout.
  function goal(name, params) {
    try { if (window.UW_METRIKA) window.UW_METRIKA.goal(name, params); } catch (_e) {}
  }

  // Tightened to 2 distinct features per card; trust items ("cancel
  // anytime", "14-day refund") live in the section-wide fine-print
  // line below the grid — no need to repeat per card.
  var EXTRAS = {
    monthly: {
      period: '/mo',
      features: [
        'Twitch, Vimeo, Kick + most other video sites',
        'Aspect-aware auto-tuning',
      ],
      cta: 'Sponsor monthly',
    },
    yearly: {
      period: '/yr',
      features: [
        'Everything in Monthly',
        '≈ $2/mo · Save 60% vs monthly',
      ],
      cta: 'Sponsor yearly',
    },
    lifetime: {
      period: '',
      features: [
        'One payment — yours forever',
        'All future updates included',
      ],
      cta: 'Get Lifetime',
    },
  };

  function effectivePerMonth(planId, p) {
    if (planId === 'yearly') return '≈ $' + (p.priceUsd / 12).toFixed(2) + '/mo';
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

    html += '<div class="lp-card-eyebrow">' +
              '<span class="lp-card-eyebrow-label">' + p.label + '</span>' +
            '</div>';

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

    // Static config.js prices are authoritative — no live /api/pricing
    // override. API_BASE is still used for the checkout POST below.
    var api = window.ULTRAWIDER && window.ULTRAWIDER.API_BASE;

    var selectedPlan = null;

    function openCheckout(planId) {
      var p = plans[planId];
      if (!p) return;
      goal('checkout_view');
      selectedPlan = planId;
      form.hidden = false;
      var billLine = planId === 'lifetime'
        ? 'One-time payment · yours forever · secure card / PayPal checkout'
        : 'Billed ' + planId + ', cancel anytime · secure card / PayPal checkout';
      summary.innerHTML =
        '<div class="landing-checkout-summary-top">' +
          '<span class="landing-checkout-summary-label">' + p.label + ' sponsorship</span>' +
          '<span class="landing-checkout-summary-price">' +
            '<span class="landing-checkout-summary-usd">$' + p.priceUsd.toFixed(2) + '</span>' +
          '</span>' +
        '</div>' +
        '<p class="landing-checkout-summary-bill">' + billLine + '</p>' +
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

    // Sponsorship explainer "Read more →" links jump to a specific FAQ
    // entry and auto-open it. Use the same [open] + .is-open pairing
    // the FAQ click-handler in index.html uses, so the open animation
    // runs from the natural starting state (0fr → 1fr) rather than
    // snapping straight to expanded.
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest('[data-faq-jump]');
      if (!trigger) return;
      var id = trigger.getAttribute('data-faq-jump');
      var target = id && document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      if (target.tagName === 'DETAILS' && !target.classList.contains('is-open')) {
        target.setAttribute('open', '');
        requestAnimationFrame(function () {
          target.classList.add('is-open');
        });
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Update the hash so the :target CSS pulse fires and a refresh
      // re-anchors the user where they were.
      if (history.replaceState) history.replaceState(null, '', '#' + id);
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!selectedPlan) return;
      var email = (emailIn.value || '').trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError('Please enter a valid email address.');
        return;
      }
      // Require explicit sponsorship acknowledgment — gives us a paper
      // trail of informed consent that this is a contribution, not a
      // consumer-product purchase.
      var ackEl = document.getElementById('landing-checkout-ack-input');
      if (ackEl && !ackEl.checked) {
        showError('Please tick the box to confirm you understand this is a sponsorship contribution.');
        return;
      }
      goal('checkout_submit');
      submit.disabled = true;
      submit.textContent = 'Creating your order…';
      errBox.hidden = true;

      var installId = new URLSearchParams(location.search).get('install_id');

      fetch(api + '/api/checkout/lava', {
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
            // localStorage copy survives the tab — /order can offer the
            // last order even after a browser restart.
            localStorage.setItem('ultrawider_last_order', data.order_id);
          } catch (_e) { /* private mode etc — ignore */ }
          // Reset the submit button in case the visitor comes back.
          submit.disabled = false;
          submit.textContent = 'Continue to payment →';
          // Lava.top's checkout page is branded and trustworthy — redirect
          // straight there, no interstitial.
          goal('checkout_redirect');
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
