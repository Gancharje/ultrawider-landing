/**
 * Order status polling. Backend handles all the joytify integration;
 * we just poll /api/orders/{id}/status every 5s until it transitions
 * to completed (license_key populated) or failed/expired.
 */
(function () {
  const params = new URLSearchParams(location.search);
  const orderId =
    params.get('id') || sessionStorage.getItem('ultrawider_last_order');

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
  }
  function formatKey(k) {
    if (!k) return '';
    return (k.match(/.{1,4}/g) || []).join('-');
  }

  async function pollOnce() {
    pollCount++;
    if (pollCount > MAX_POLLS) {
      showFailed(
        'Timed out waiting for confirmation. If your card was charged, your key was emailed anyway — check your inbox. Otherwise no charge was made.',
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
        showFailed('Payment was not completed. No charge was made.');
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
