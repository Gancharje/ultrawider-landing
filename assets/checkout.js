/**
 * Checkout page logic: pull plan + install_id from query, render summary,
 * submit email to backend (POST /api/checkout/lava), then open Lava.top's
 * branded card / PayPal checkout page in a new tab.
 */
(function () {
  const params = new URLSearchParams(location.search);
  const plan = params.get('plan');
  const installId = params.get('install_id');

  const PLANS = window.ULTRAWIDER.PLANS;
  if (!plan || !PLANS[plan]) {
    location.href = '/pricing';
    return;
  }
  const p = PLANS[plan];

  // Metrika loads deferred, i.e. AFTER this classic script executes —
  // page-load goals must wait for DOMContentLoaded (fires after deferred
  // scripts), interaction goals can call UW_METRIKA directly.
  function goal(name, gp) {
    if (window.UW_METRIKA) {
      window.UW_METRIKA.goal(name, gp);
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        if (window.UW_METRIKA) window.UW_METRIKA.goal(name, gp);
      });
    }
  }
  goal('checkout_view');

  function renderSummary(note) {
    const isLifetime = plan === 'lifetime';
    const billLine = isLifetime
      ? 'One-time payment · yours forever · no renewals'
      : 'Auto-renews ' + plan + ' · cancel anytime';
    document.getElementById('summary').innerHTML =
      '<h2>Ultrawider Pro — ' + p.label + '</h2>' +
      '<p class="summary-price">' +
        '<span class="summary-usd">$' + p.priceUsd.toFixed(2) + '</span> ' +
        '<span class="summary-dur">· license active ' + p.duration + '</span></p>' +
      '<p class="summary-bill">' + billLine + ' · secure card / PayPal checkout</p>' +
      '<p class="summary-bill">A Pro license key by email in ~5 minutes.</p>' +
      (note ? '<p class="hint">' + note + '</p>' : '');
  }
  renderSummary();

  const form = document.getElementById('checkout-form');
  const btn = document.getElementById('submit-btn');
  const err = document.getElementById('error');

  function showError(msg) {
    err.textContent = msg;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Continue to payment →';
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    if (!email) return;

    goal('checkout_submit');
    btn.disabled = true;
    btn.textContent = 'Creating your order…';
    err.hidden = true;

    // Card → UNLIMINT, PayPal → PAYPAL. Card is the default selection.
    const payMethodEl = document.querySelector('input[name="checkout-pay-method"]:checked');
    const paymentProvider = (payMethodEl && payMethodEl.value === 'paypal') ? 'PAYPAL' : 'UNLIMINT';

    try {
      const resp = await fetch(window.ULTRAWIDER.API_BASE + '/api/checkout/lava', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: plan,
          email: email,
          paymentProvider: paymentProvider,
          install_id: installId || undefined,
        }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(function () { return {}; });
        showError(
          'Could not create order: ' +
            (body.message || 'server error (' + resp.status + ')') +
            '. Please try again or email ' +
            window.ULTRAWIDER.CONTACT_EMAIL,
        );
        return;
      }
      const data = await resp.json();
      // Stash the order_id so the user can come back to /order?id=...
      // even if they close the payment tab.
      sessionStorage.setItem('ultrawider_last_order', data.order_id);
      // Also store an order URL we can deep-link to from the email later.
      sessionStorage.setItem(
        'ultrawider_order_url',
        '/order?id=' + data.order_id,
      );
      // localStorage copy survives the tab — /order can offer the last
      // order even after a browser restart.
      try { localStorage.setItem('ultrawider_last_order', data.order_id); } catch (_e) {}
      // Keep the visitor here: open Lava.top's checkout in a NEW TAB and
      // swap the form for a short confirmation.
      goal('checkout_redirect');
      const win = window.open(data.payment_url, '_blank', 'noopener');
      form.hidden = true;
      err.hidden = true;
      document.getElementById('summary').innerHTML =
        '<div class="checkout-confirm">' +
          '<h2>Checkout opened in a new tab.</h2>' +
          '<p>Your Pro key will arrive by email within ~5 minutes of payment.</p>' +
          (win ? '' :
            '<p><a href="' + data.payment_url + '" target="_blank" rel="noopener">Open the payment page →</a></p>') +
        '</div>';
    } catch (e) {
      showError(
        "Couldn't reach our servers. Check your connection and try again, or email " +
          window.ULTRAWIDER.CONTACT_EMAIL,
      );
    }
  });
})();
