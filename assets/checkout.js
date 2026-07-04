/**
 * Checkout page logic: pull plan + install_id from query, render summary,
 * refresh live prices from /api/pricing, submit email to backend, then
 * show a branded interstitial BEFORE handing the visitor off to Joytify —
 * the payment page looks like a gaming top-up store, so expectations must
 * be set on our domain first.
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
    document.getElementById('summary').innerHTML =
      '<h2>Ultrawider Pro — ' + p.label + '</h2>' +
      '<p class="summary-stars">⭐ ' + p.starsAmount + ' Stars · ' +
      '<span class="summary-usd">≈ $' + p.priceUsd.toFixed(2) + '</span> ' +
      '<span class="summary-dur">· license active ' + p.duration + '</span></p>' +
      (note ? '<p class="hint">' + note + '</p>' : '');
  }
  renderSummary();

  // config.js prices are cold-load defaults; the card is charged whatever
  // Joytify currently lists (backend scrapes hourly). Show the live price
  // so the summary matches the actual charge. On fetch failure the
  // defaults stand — flagged as approximate.
  fetch(window.ULTRAWIDER.API_BASE + '/api/pricing', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      const live = data && data.plans && data.plans[plan];
      if (!live) throw new Error('no live pricing');
      if (typeof live.priceUsd === 'number') p.priceUsd = live.priceUsd;
      if (typeof live.starsAmount === 'number') p.starsAmount = live.starsAmount;
      renderSummary();
    })
    .catch(function () {
      renderSummary('≈, final price shown at payment');
    });

  const form = document.getElementById('checkout-form');
  const btn = document.getElementById('submit-btn');
  const err = document.getElementById('error');

  function showError(msg) {
    err.textContent = msg;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Continue to payment →';
  }

  // Interstitial between "order created" and the Joytify redirect. Gives
  // the customer the order id + what-to-expect copy while the context is
  // still trustworthy (our domain, our design).
  function showInterstitial(orderId, paymentUrl) {
    const box = document.getElementById('interstitial');
    document.getElementById('int-stars').textContent = p.starsAmount;
    document.getElementById('int-usd').textContent = p.priceUsd.toFixed(2);
    document.getElementById('int-order-id').textContent = orderId;
    const orderLink = document.getElementById('int-order-link');
    orderLink.href = '/order?id=' + encodeURIComponent(orderId);
    orderLink.textContent = 'ultrawider.net/order?id=' + orderId;

    form.hidden = true;
    err.hidden = true;
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });

    document.getElementById('int-continue').addEventListener('click', function () {
      goal('checkout_redirect');
      location.assign(paymentUrl);
    });

    const copyLink = document.getElementById('int-copy-link');
    copyLink.addEventListener('click', function (e) {
      e.preventDefault();
      try {
        navigator.clipboard.writeText(paymentUrl);
        copyLink.textContent = 'Copied!';
        setTimeout(function () {
          copyLink.textContent = 'copy payment link';
        }, 1500);
      } catch (_e) { /* clipboard unavailable — link still works via Continue */ }
    });
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    if (!email) return;

    // Require explicit sponsorship acknowledgment — paper trail of
    // informed consent that this is a contribution, not a consumer-
    // product purchase.
    const ackEl = document.getElementById('checkout-ack-input');
    if (ackEl && !ackEl.checked) {
      showError('Please tick the box to confirm you understand this is a sponsorship contribution.');
      return;
    }

    goal('checkout_submit');
    btn.disabled = true;
    btn.textContent = 'Creating your order…';
    err.hidden = true;

    try {
      const resp = await fetch(window.ULTRAWIDER.API_BASE + '/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: plan,
          email: email,
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
      // NOT an instant redirect: show the branded interstitial first so
      // the Joytify hand-off doesn't read as a scam.
      showInterstitial(data.order_id, data.payment_url);
    } catch (e) {
      showError(
        "Couldn't reach our servers. Check your connection and try again, or email " +
          window.ULTRAWIDER.CONTACT_EMAIL,
      );
    }
  });
})();
