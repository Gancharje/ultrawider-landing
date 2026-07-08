// Build-time single source of truth for site URLs + plan pricing.
//
// The PLANS table mirrors the Lava.top subscription products our
// backend creates checkout orders against. priceUsd MUST match what
// Lava.top actually charges the card / PayPal account.
//
// Lava supports THREE plans: monthly ($5.00), yearly ($24.00 ≈ $2/mo)
// and lifetime ($49.00 one-time, license never expires). These static
// values are authoritative — the landing no longer fetches a live
// /api/pricing override.
window.ULTRAWIDER = {
  API_BASE: 'https://api.ultrawider.net',
  CONTACT_EMAIL: 'hello@ultrawider.net',
  PLANS: {
    monthly: {
      label: 'Monthly',
      priceUsd: 5.00,
      duration: '30 days',
      badge: null,
    },
    yearly: {
      label: 'Yearly',
      priceUsd: 24.00,
      duration: '12 months',
      badge: 'Best value',
    },
    lifetime: {
      label: 'Lifetime',
      priceUsd: 49.00,
      duration: 'forever',
      badge: null,
    },
  },
};
