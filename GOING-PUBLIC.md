# Going public — monetization strategy

> Strategy notes for taking Shoplist from a private family app to a public,
> lightly-monetized product. Nothing here is built yet — this is the playbook to
> revisit when we decide to go for it. Last updated 2026-06-16.

## 1. The model in one line

**Free, genuinely useful app + a Pro subscription that unlocks unlimited AI and
higher limits.** Income comes from people who love the AI "magic" enough to pay;
everyone else keeps a fully working shopping list for free. This protects the
family-app heritage (don't nickel-and-dime core list-making) while charging for
the part that actually costs money (Gemini).

## 2. Free vs Pro

| | Free | Pro |
|---|---|---|
| Core lists (add/check/edit/share/realtime) | ✅ unlimited | ✅ |
| **AI features** (recipe import, voice→list, photo→list, smart quantity parse, auto-categorize) | **N actions / month, then off** | ✅ unlimited |
| Number of lists | capped (e.g. 5) | raised / unlimited |
| Shared members per list | capped (e.g. 2) | raised |
| Image uploads (ImgBB-backed item photos) | capped | raised |

**Guiding principle — never break the core app.** When a free user runs out of
AI quota, AI features degrade gracefully rather than blocking the screen:
- Typing `2 milk, 3 eggs` falls back to the **deterministic** `splitPlainItems()`
  parser (already in the codebase) instead of the Gemini `extractAddItems` call —
  the item still gets added, just without AI-parsed quantity/category.
- Recipe/voice/photo import show a friendly "AI limit reached — upgrade to Pro"
  prompt instead of running.

This is important: `extractAddItems` is the **highest-frequency** AI call (it
fires on essentially every multi-item add). If it counted against quota and hard-
blocked, the free tier would feel broken within a day. Reserve the quota for the
deliberate "wow" imports; let everyday adding degrade silently.

**Suggested starting numbers (tune from real Gemini cost):**
- Free AI quota: **~15 AI actions / calendar month**, reset on the 1st.
- Price Pro to comfortably cover Vercel Pro + Supabase Pro + variable Gemini at
  expected conversion. A common indie price point is **~€3–5/month or ~€30/year**.
  Validate against actual unit economics before committing.

## 3. What counts as one "AI action"

Quota is consumed only by a real Gemini call. The gated features (all converge on
`src/lib/gemini.ts`):
- Recipe import (`extractRecipeItems`)
- Voice → list / task / note (`extractItemsFromAudio`, `extractTasksFromAudio`, `transcribeNote`)
- Photo → list / task (`extractListItemsFromImage`, `extractTasksFromImage`)
- Image item naming (`suggestItemName`)
- Smart quantity parse on add (`extractAddItems`) — **but** degrade to `splitPlainItems()` when over quota rather than block
- Auto-categorize (`categorizeItem`) — cheap; consider **not** charging for it (keeps the list tidy for free users)

`unfurlLink` is *not* AI (plain OpenGraph fetch) — never counts.

## 4. How we'd enforce it (when we build)

- **One choke point.** All Gemini calls go through `src/lib/gemini.ts`
  (`callGemini` / `callGeminiWithAudio` / `callGeminiWithImage`). But quota needs
  the user id, which the pure wrapper doesn't have — so add a small
  `consumeAiCredit(userId, feature)` helper called at the **top of each AI server
  action** (~9 of them, all in `actions/import.ts`, `actions/upload.ts`,
  `actions/items.ts`). It checks remaining quota, throws a typed
  `AiQuotaExceeded` error if empty, and increments on success. Failed Gemini calls
  must **not** consume quota.
- **Storage.** New `user_subscriptions` table (next migration is `0032`):
  `user_id` (PK), `tier` ('free'|'pro'), `status`, `current_period_end`,
  plus a usage counter — either columns (`ai_used_this_period`,
  `period_resets_at`) or a separate `user_ai_usage` (user_id, period, count).
  Keep it **separate** from `user_preferences` (billing ≠ UI prefs).
- **Client UX.** Surface remaining quota and a "Upgrade" affordance; catch
  `AiQuotaExceeded` in the modals/`useAddItems` and show the upsell instead of an
  error toast.
- **Per-user, not per-list.** Quota and tier attach to the acting user; an AI
  action counts against whoever triggered it. (Family/household sharing of Pro is
  a later question — see Open questions.)

## 5. Payments — Merchant of Record

Use **Lemon Squeezy or Paddle** (both are MoR). They are the legal seller of
record: they collect the correct VAT in every buyer's country, file it, and remit
it — we never touch a tax return. Fees ~5–8% all-in; worth it to skip EU
VAT/OSS registration via Skatteverket. (Note: cross-border digital sales to EU
consumers have **no VAT threshold** — the obligation starts at sale #1, which is
exactly why MoR is the right call at this stage.)

Integration shape (later): MoR checkout link → webhook to a new
`/api/webhooks/billing` route → upsert `user_subscriptions.tier`/`status`. Gate
on that column. Keep billing behind one module so we could swap to Stripe later
if revenue ever justifies handling VAT ourselves.

## 6. Infrastructure & cost reality

- ⚠️ **Vercel Hobby is non-commercial use only.** A public-but-**free** app
  (no checkout) is still non-commercial — so we can launch publicly, run a free
  beta, and gather users on Hobby. The trigger to flip to **Pro (~$20/mo)** is the
  day paid billing goes live, not earlier. The flip is **reversible**: if we ever
  turned the paywall off we could downgrade back and the app keeps running as-is
  (we use no Pro-only features — crons run on Supabase pg_cron, not Vercel), modulo
  Hobby's lower bandwidth/function limits.
- **Supabase free tier** carries us a long way: 50k MAU, 500 MB DB, ~200 concurrent
  realtime connections, ~2M realtime messages/month. We'll outgrow **realtime
  concurrency** and **DB size** before MAU. Move to **Supabase Pro (~$25/mo)** when
  we approach those.
- **Variable cost = Gemini + ImgBB**, both pay-as-you-go and both cheap per call
  (Flash models). The AI paywall exists precisely to keep this in the black.
- **Fixed floor once commercial: ~$45/mo** (Vercel Pro + Supabase Pro). First
  goal is for Pro subscriptions to cover that.

**Scaling levers to pull before paying for upgrades:**
- Trim client log volume (`app_logs` growth) — increase sampling / drop low-value
  events; ensure the `pg_cron` 30-day prune is actually enabled.
- Realtime: the overview channel subscribes broadly per user — watch concurrent
  connection count as users grow.

## 7. Opening signup (the easy part)

Public signup is currently off at the **Supabase provider level** (one dashboard
toggle), not in code — `/auth/signup` is ready and the middleware already lets
`/welcome.html` through unauthenticated. To go public:
1. Supabase → Auth → enable "Allow new users to sign up".
2. **Turn on email confirmation + a CAPTCHA / rate limit** — essential once public,
   to stop fake accounts farming free AI quota.
3. Spread `welcome.html` (add basic analytics + real screenshots; it's currently
   CSS/SVG mockups).

## 8. Pre-launch checklist (when we commit)

- [ ] Upgrade Vercel to Pro — **only when paid billing goes live** (free public beta stays on Hobby).
- [ ] Add Privacy Policy + Terms (required by app stores / MoR / GDPR).
- [ ] GDPR basics: data export + account deletion path.
- [ ] Enable email confirmation + signup abuse protection.
- [ ] Build `user_subscriptions` + `consumeAiCredit` quota enforcement.
- [ ] Wire MoR checkout + billing webhook.
- [ ] Decide & set Pro price from real unit economics.
- [ ] Real screenshots + analytics on `welcome.html`.
- [ ] Load-test realtime + check Supabase usage headroom.

## 9. Open questions (decide later)

- **Free quota number** — start ~15/mo, adjust from real Gemini cost + conversion.
- **Pro price** — €/month vs annual; validate willingness to pay.
- **Family/household Pro** — does one Pro cover a shared family, or is it per-user?
  (The app's whole identity is family sharing, so a household plan may matter.)
- **Exact non-AI free caps** (lists / members / images) — keep free genuinely
  useful; don't strangle the family use case that built the product.
- **i18n** — app is Swedish; going "public" may mean broader audience → English.
