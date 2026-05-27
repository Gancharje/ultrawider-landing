// Build-time single source of truth for site URLs + plan pricing.
//
// The PLANS table mirrors the real Joytify Telegram-Stars packages
// that our backend creates orders against. starsAmount and priceUsd
// MUST match what Joytify charges, otherwise the customer sees a
// different amount on Tazapay than on the landing.
//
// At runtime the /pricing page can ALSO fetch live prices from
// /api/pricing (see backend cron job), which overrides these values
// if newer. These are the safety-net defaults for cold loads.
window.ULTRAWIDER = {
  API_BASE: 'https://api.ultrawider.net',
  CONTACT_EMAIL: 'hello@ultrawider.net',
  PLANS: {
    monthly: {
      label: 'Monthly',
      starsAmount: 150,
      priceUsd: 2.89,
      duration: '30 days',
      badge: null,
    },
    quarterly: {
      label: '3 Months',
      starsAmount: 400,
      priceUsd: 7.72,
      duration: '90 days',
      badge: 'Save 11%',
    },
    yearly: {
      label: 'Yearly',
      starsAmount: 1200,
      priceUsd: 23.15,
      duration: '12 months',
      badge: 'Best value',
    },
    lifetime: {
      label: 'Lifetime',
      starsAmount: 2500,
      priceUsd: 48.23,
      duration: 'forever',
      badge: null,
    },
  },
};
