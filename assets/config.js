// Build-time single source of truth for site URLs. Change here on deploy
// (or set via Cloudflare Pages env vars in a future build step). Keeping
// it in vanilla JS — no bundler — so it's served directly by GH Pages.
window.ULTRAWIDER = {
  API_BASE: 'https://api.ultrawider.net',
  CONTACT_EMAIL: 'hello@ultrawider.net',
  PLANS: {
    monthly:   { label: 'Monthly',   price: 2.99,  duration: '30 days',  badge: null },
    quarterly: { label: '3 Months',  price: 7.99,  duration: '90 days',  badge: 'Save 11%' },
    yearly:    { label: 'Yearly',    price: 24.99, duration: '12 months', badge: 'BEST VALUE' },
    lifetime:  { label: 'Lifetime',  price: 49.99, duration: 'forever',   badge: null },
  },
};
