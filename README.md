# Ultrawider — Landing Page

Marketing site for [Ultrawider](https://ultrawider.net), a Chrome extension
that converts standard 16:9 YouTube video into true 21:9 ultrawide using
content-aware S-curve warping.

Hosted on GitHub Pages from this repository at https://ultrawider.net.

## Structure

```
ultrawider-landing/
├── index.html           Landing page (hero + playground + math + pricing + FAQ)
├── pricing/             Standalone pricing page (mirrors #pricing section)
├── checkout/            Email-capture + plan summary before payment redirect
├── order/               Post-payment success page (license key delivery)
├── recover/             Recover-license-by-email flow
├── contact/             Contact page (mailto: anchor + install/Get Pro CTAs)
├── terms.html           Terms of Service
├── privacy.html         Privacy Policy
├── refund.html          Refund Policy
├── style.css            Single stylesheet, dark theme, amber accent
├── assets/
│   ├── config.js              Plans + API base + contact email
│   ├── warp-demo.js           WebGL playground (live shader)
│   ├── math-demo.js           Interactive math section (slider + face warp)
│   ├── aspect-profile.js      Viewport aspect detector
│   ├── landing-checkout.js    Inline pricing card renderer + email capture
│   ├── checkout.js            /checkout page logic
│   └── order.js               /order page polling + license display
├── demo/                Source video + face image used by the playground/math
└── CNAME                Custom domain: ultrawider.net
```

No build step. Plain HTML + CSS + vanilla JS.

## Local preview

```bash
python -m http.server 8765
```

Then open http://localhost:8765/. **Do not open `index.html` directly via
`file://`** — absolute paths (`/style.css`, `/assets/...`) only resolve
under an HTTP server.

## Deployment

Pushed to `main`. GitHub Pages serves the root of `main` at
`https://ultrawider.net` (custom domain configured via CNAME + Cloudflare
DNS).

## Pricing model

Sponsorship-framed Telegram Stars via Joytify → Tazapay (Singapore) payment
gateway → license key emailed. Visitor pays by **Visa or Mastercard**;
Tazapay is the only acceptance set we promise upfront.

Plan amounts live in [`assets/config.js`](assets/config.js) and are
mirrored hourly from the backend `/api/pricing` endpoint (which scrapes
Joytify). The four tiers are Monthly / 3-Month / Yearly / Lifetime.

## Updating the demo video

Replace `demo/playground-source.mp4` with a new MP4. Compress with ffmpeg:

```bash
ffmpeg -i input.mp4 -vcodec libx264 -preset slow -crf 28 \
       -vf "scale='min(1920,iw)':-2" -an -movflags +faststart \
       demo/playground-source.mp4
```

Target file size: under ~4 MB to keep first-load LCP fast.

## Updating legal docs

Each legal page has a "Last updated" line near the top. Bump it when you
make material changes.

## Contact

hello@ultrawider.net
