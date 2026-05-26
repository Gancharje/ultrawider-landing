/**
 * Checkout page logic: pull plan + install_id from query, render summary,
 * submit email to backend, redirect to joytify payment URL.
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

  document.getElementById('summary').innerHTML =
    '<h2>Ultrawider Pro — ' + p.label + '</h2>' +
    '<p>$' + p.price.toFixed(2) + ' · valid for ' + p.duration + '</p>';

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
      // Redirect to joytify (which will JS-redirect to Tazapay checkout).
      location.assign(data.payment_url);
    } catch (e) {
      showError(
        "Couldn't reach our servers. Check your connection and try again, or email " +
          window.ULTRAWIDER.CONTACT_EMAIL,
      );
    }
  });
})();
