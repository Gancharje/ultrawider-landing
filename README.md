# Ultrawider — Landing Page

Marketing site for [Ultrawider](https://ultrawider.net), a Chrome extension
that converts standard 16:9 YouTube video into true 21:9 ultrawide using
content-aware S-curve warping.

Hosted on GitHub Pages from this repository at https://ultrawider.net.

## Structure

```
ultrawider-landing/
├── index.html           EN landing
├── terms.html           EN Terms of Service
├── privacy.html         EN Privacy Policy
├── refund.html          EN Refund Policy
├── ru/
│   ├── index.html       RU landing
│   ├── terms.html       RU Условия использования
│   ├── privacy.html     RU Политика конфиденциальности
│   └── refund.html      RU Политика возвратов
├── style.css            Single stylesheet, dark theme, amber accent
├── lang-switch.js       Auto-detect + cookie language switcher
├── demo/
│   ├── ultrawider-demo.mp4
│   └── ultrawider-sample.mp4
└── CNAME                Custom domain: ultrawider.net
```

No build step. Plain HTML + CSS + ~80 lines of vanilla JS for the language
switcher. Fonts loaded from Google Fonts (Inter).

## Local preview

Open a terminal in this folder and run:

```bash
python -m http.server 8765
```

Then open http://localhost:8765/ in a browser. **Do not open `index.html`
directly via `file://`** — absolute paths (`/ru/`, `/style.css`) only
resolve correctly under an HTTP server.

## Deployment

Pushed to `main`. GitHub Pages serves the root of `main` at
`https://ultrawider.net` (custom domain configured via CNAME + Cloudflare
DNS).

## Languages

- EN at `/` (default)
- RU at `/ru/`

Language switching:
- Cookie `ultrawider_lang` stores the user's chosen language
- First-visit Russian-language browsers are auto-redirected to `/ru/`
- Once the cookie is set, no further auto-redirects happen — manual choice
  always wins

To add a new language, create `/<lang>/` mirror pages with absolute paths
(`/style.css`, `/lang-switch.js`, `/demo/...`) and extend `lang-switch.js`
to handle the new locale.

## Pricing model (snapshot)

Single one-time purchase: **Alpha Access — USD 3.99 (≈ 320 ₽)**, lifetime
licence, lifetime updates. Locked-in price for early adopters; we'll raise
it for new buyers after public launch.

There is **no subscription** model. Do not introduce any subscription copy
without updating the legal docs in lockstep.

## Payment processing

Payments are processed by **Prodamus** (Russian payment aggregator).
Merchant configuration:

- Merchant ID: _TODO — finalising_
- Checkout URL: _TODO — will replace `href="#"` on Alpha CTA buttons_
- Webhook: _TODO_

## Operator (legal footer requirement)

Required on every page — both EN and RU — by Prodamus.

- Self-employed: Akimov Pavel Andreevich
- INN: 482424418541
- City: Lipetsk, Russia
- Contact: hello@ultrawider.net

## Updating the demo video

Replace `demo/ultrawider-demo.mp4` (or `…-sample.mp4`) with a new 21:9 MP4.
The page picks it up automatically. Compress with ffmpeg:

```bash
ffmpeg -i input.mp4 -vcodec libx264 -preset slow -crf 28 \
       -vf "scale='min(1920,iw)':-2" -an -movflags +faststart \
       demo/ultrawider-demo.mp4
```

Target file size: under ~4 MB to keep first-load LCP fast.

## Updating legal docs

Each legal page (EN and RU) has a "Last updated" line near the top. Bump
that date when you make material changes. Keep EN ↔ RU in sync — both
versions are linked as `hreflang` alternates.

## Prodamus warranty letter

The signed "Гарантийное письмо" for Prodamus is generated locally from a
private template at `templates/garantiynoe-pismo-template.docx` (kept
outside the repo — contains passport data and is **not** committed).

The output document and any filled `.docx` containing personal data are
also kept out of the repo. See the `templates/` and `docs/` paths in the
parent working directory.

## Contact

hello@ultrawider.net
