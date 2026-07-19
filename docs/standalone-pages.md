# Standalone, unlinked pages

Two static pages ship in `public/` that are **deliberately unlinked** from the app (no nav/footer reference) and **excluded from the edge-middleware auth gate** so they load without login. If you rename either file, update its `proxy.ts` matcher exclusion (and the `next.config.ts` rewrite for `/fb`).

## Marketing / landing page — `public/welcome.html`

Served statically at `https://shoplist-eta.vercel.app/welcome.html`. Excluded from auth via the `welcome.html` entry in the `proxy.ts` matcher. Self-contained (only external dep is Google Fonts); CSS/SVG mockups stand in for screenshots, reusing the Shoplist theme palette.

> Future monetization / go-public strategy (free app + Pro AI paywall, Merchant-of-Record payments, free-tier limits) lives in `GOING-PUBLIC.md` — a forward-looking playbook, nothing built yet.

## World Cup schedule page — `public/vm-2026-schema.html`

A personal, unrelated-to-Shoplist artifact: a static, hand-compiled Fotbolls-VM 2026 TV-schedule (Swedish times, SVT/TV4 channels). Both `vm-2026-schema.html` and its short alias `/fb` are excluded from the `proxy.ts` matcher; `/fb` → `/vm-2026-schema.html` via a rewrite in `next.config.ts`. Served at `https://shoplist-eta.vercel.app/fb` (or `/vm-2026-schema.html`).

It is **not** a live feed — transcribed once from Swedish source sites, so it goes stale and can have gaps. Verify pairings/dates against ESPN/FIFA/Al Jazeera (not Wikipedia, per user) before editing. The match-by-match update history lives in git; there's no need to keep it here.
