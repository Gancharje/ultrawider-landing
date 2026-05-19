# Ultrawider — Landing Page

Marketing site for [Ultrawider](https://ultrawider.net), a Chrome extension that
converts standard 16:9 video into true 21:9 ultrawide using content-aware S-curve
warping.

Hosted on GitHub Pages from this repository.

## Structure

```
ultrawider-landing/
├── index.html         Main landing page
├── terms.html         Terms of Service
├── privacy.html       Privacy Policy (GDPR + CCPA)
├── refund.html        Refund Policy (30-day money-back)
├── style.css          Single stylesheet, dark theme, amber accent
├── demo/              Demo video assets
│   ├── ultrawider-demo.mp4
│   └── ultrawider-sample.mp4
└── CNAME              Custom domain for GitHub Pages (added later)
```

No build step. Plain HTML + CSS. Fonts loaded from Google Fonts (Inter).

## Local preview

Open `index.html` directly in a browser. For best results view on a 21:9 or
wider display — the hero video is rendered in a 21:9 frame.

## Deployment

Pushed to `main` on this repository. GitHub Pages serves the root of `main`.
Live at:

- `https://gancharje.github.io/ultrawider-landing/` (GitHub Pages default)
- `https://ultrawider.net` (custom domain, configured via Cloudflare DNS)

## Updating the demo video

Replace `demo/ultrawider-demo.mp4` with a new 21:9 (or wider) MP4. The page
will pick it up automatically — `<video>` tag references the same path. Keep
the file under ~10 MB for sensible page-load times; consider a poster image
for slow connections.

## Updating legal docs

Each legal page has a "Last updated" line near the top. Bump that date when
you make material changes.

## Tech stack

- Static HTML / CSS — no framework
- Inter font via Google Fonts
- Native `<details>` for FAQ accordions (no JS)
- `<video>` with `autoplay muted loop playsinline` for hero demo

## Contact

`hello@ultrawider.net`
