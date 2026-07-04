/**
 * Order status polling. Backend handles all the joytify integration;
 * we just poll /api/orders/{id}/status every 5s until it transitions
 * to completed (license_key populated) or failed/expired.
 */
(function () {
  const params = new URLSearchParams(location.search);
  // localStorage fallback: checkout persists the last order id there so
  // this page still works after the payment tab / browser was closed.
  const orderId =
    params.get('id') ||
    sessionStorage.getItem('ultrawider_last_order') ||
    localStorage.getItem('ultrawider_last_order');

  if (!orderId) {
    location.href = '/pricing';
    return;
  }

  const POLL_INTERVAL_MS = 5000;
  const MAX_POLLS = 240; // 20 min total
  let pollCount = 0;

  function showComplete(key) {
    document.getElementById('processing').hidden = true;
    document.getElementById('complete').hidden = false;
    document.getElementById('key-display').textContent = formatKey(key);
  }
  function showFailed(msg) {
    document.getElementById('processing').hidden = true;
    document.getElementById('failed').hidden = false;
    document.getElementById('failure-reason').textContent = msg;
    // Keep the order id visible + a prefilled support mailto so a
    // charged-but-expired customer can reach us with everything we need.
    const idEl = document.getElementById('failed-order-id');
    if (idEl) idEl.textContent = orderId;
    const mail = document.getElementById('support-mail');
    if (mail) {
      mail.href =
        'mailto:' + window.ULTRAWIDER.CONTACT_EMAIL +
        '?subject=' + encodeURIComponent('Order ' + orderId + ' — payment issue');
    }
  }
  function formatKey(k) {
    if (!k) return '';
    return (k.match(/.{1,4}/g) || []).join('-');
  }

  async function pollOnce() {
    pollCount++;
    if (pollCount > MAX_POLLS) {
      // Never claim "no charge was made" — we can't know that from here.
      showFailed(
        'Timed out waiting for confirmation. If your card was charged, your key was emailed anyway — check your inbox and spam. No email? Write ' +
          window.ULTRAWIDER.CONTACT_EMAIL + ' with order ID ' + orderId +
          ' — we check payments even after expiry.',
      );
      return;
    }

    try {
      const resp = await fetch(
        window.ULTRAWIDER.API_BASE + '/api/orders/' + encodeURIComponent(orderId) + '/status',
      );
      if (!resp.ok) {
        setTimeout(pollOnce, POLL_INTERVAL_MS);
        return;
      }
      const data = await resp.json();
      if (data.order_status === 'completed' && data.license_key) {
        showComplete(data.license_key);
        return;
      }
      if (data.order_status === 'failed' || data.order_status === 'expired') {
        // Never claim "no charge was made" — the payment can land after
        // the order expires, and telling a charged customer nothing
        // happened is how we lose them.
        showFailed(
          'This order expired before payment was confirmed. If your card was NOT charged — nothing happened, you can start over. If your card WAS charged — email ' +
            window.ULTRAWIDER.CONTACT_EMAIL + ' with order ID ' + orderId +
            " and we'll issue your key right away (we check payments even after expiry).",
        );
        return;
      }
      setTimeout(pollOnce, POLL_INTERVAL_MS);
    } catch (e) {
      setTimeout(pollOnce, POLL_INTERVAL_MS);
    }
  }

  document.getElementById('copy-btn')?.addEventListener('click', function () {
    const k = document.getElementById('key-display').textContent;
    navigator.clipboard.writeText(k);
    const btn = document.getElementById('copy-btn');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function () {
      btn.textContent = orig;
    }, 1500);
  });

  pollOnce();
})();
