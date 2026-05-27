// Build-time single source of truth for site URLs + plan pricing.
//
// The PLANS table mirrors the real Joytify Telegram-Stars packages
// that our backend creates orders against. starsAmount and priceUsd
// MUST match what Tazapay actually CHARGES the card.
//
// IMPORTANT — Joytify exposes TWO prices per Star package:
//   - `price` (the "From $X.XX" display value on listings)
//   - `pricePerDenom.price` (the REAL card payment amount via CARD_TA)
// These differ by ~3% (e.g., 150 Stars: "From $2.89" but actual
// charge $2.98). We show pricePerDenom.price here — that's what the
// customer will see on their bank statement.
//
// At runtime /pricing also fetches /api/pricing from backend to
// override these (backend scrapes lapakgaming hourly). These values
// are the safety-net cold-load defaults.
window.ULTRAWIDER = {
  API_BASE: 'https://api.ultrawider.net',
  CONTACT_EMAIL: 'hello@ultrawider.net',
  PLANS: {
    monthly: {
      label: 'Monthly',
      starsAmount: 150,
      priceUsd: 2.98,
      duration: '30 days',
      badge: null,
    },
    quarterly: {
      label: '3 Months',
      starsAmount: 400,
      priceUsd: 7.95,
      duration: '90 days',
      badge: 'Save 11%',
    },
    yearly: {
      label: 'Yearly',
      starsAmount: 1200,
      priceUsd: 23.84,
      duration: '12 months',
      badge: 'Best value',
    },
    lifetime: {
      label: 'Lifetime',
      starsAmount: 2500,
      priceUsd: 49.68,
      duration: 'forever',
      badge: null,
    },
  },
};
