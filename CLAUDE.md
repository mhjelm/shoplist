# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Family shopping list web app: each user has personal lists; lists can be shared with other family members for real-time collaboration. The product scope (features and explicit non-goals) lives in `PRD.md` — consult it before proposing new features.

## Commands

```
npm run dev      # next dev (localhost:3000)
npm run build    # next build
npm run start    # serve production build
npm run lint     # eslint
```

No test framework is configured.

Required env vars (Supabase project): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Supabase (Auth + Postgres + Realtime) · Vercel.

## Architecture

### Three Supabase clients — pick the right one

The `@supabase/ssr` package requires different clients depending on context. They live in `src/lib/supabase/`:

- `server.ts` → `createClient()` — for Server Components and Server Actions. Async; reads cookies via `next/headers`.
- `client.ts` → `createClient()` — for Client Components. Uses `createBrowserClient`. Use this for Realtime subscriptions.
- `middleware.ts` → `updateSession()` — only called from the edge middleware. Refreshes the auth cookie on every request and gates routes.

Mixing these up (e.g., using the browser client on the server) is the most common source of bugs.

### Edge middleware lives in `src/proxy.ts`

Next.js 16 renamed `middleware.ts` → `proxy.ts` and `middleware()` → `proxy()`. The file at `src/proxy.ts` is the edge middleware; do not rename it back. It delegates to `updateSession` and handles all redirects:

- Unauthenticated + non-`/auth` route → `/auth/login`
- Authenticated + `/auth/*` route → `/lists`
- Authenticated + `/` → `/lists`

Because the middleware enforces auth, page components can assume `user` exists after `getUser()` and use `redirect('/auth/login')` only as a defensive guard.

### Authorization is in the database, not the app

Row-Level Security (RLS) is the authorization layer. The schema (`supabase/migrations/0001_init.sql`) defines policies for every table that use two `SECURITY DEFINER` helpers:

- `has_list_access(uuid)` — true if the caller owns or is a member of the list. Used in RLS policies for `items`, `list_members`, and `lists` selects.
- `find_user_by_email(text)` — narrow lookup into `auth.users` (not otherwise exposed) for invitations.

**Implication:** server actions don't (and shouldn't) re-check authorization in app code. Just run the query; if the user lacks access, RLS returns no rows or rejects the write. The only checks in app code are owner-only operations (delete list, invite member) where the policy already enforces it but UI hides the affordance.

### Server Actions + `revalidatePath` is the mutation pattern

All writes go through `'use server'` actions colocated next to the route (e.g., `src/app/lists/[id]/actions.ts`). The pattern is:

1. Create a server-side Supabase client.
2. Perform the insert/update/delete.
3. Return `{ error }` on failure (no throw).
4. Call `revalidatePath(...)` on success.

Server Components re-render with fresh data on the next navigation; the client tier handles instantaneous UX via optimistic updates.

### Optimistic UI + Realtime (in `ItemList.tsx`)

The item list is a Client Component that:

1. Receives `initialItems` from the server.
2. Maintains local state for instant feedback on add/toggle/delete (optimistic — reverts on action error).
3. For **shared** lists only, subscribes to a Supabase Realtime channel filtered by `list_id` and merges INSERT/UPDATE/DELETE events into local state.

Private lists skip the realtime subscription. When changing mutation logic, update both the optimistic path *and* ensure the eventual server response/realtime echo doesn't double-apply.

### User preferences are server-side, read in layout

User-level UI preferences (theme, list text size) live in the `user_preferences` table (one row per user, lazily upserted). `src/lib/preferences.ts` exposes `getUserPreferences()` — wrapped in `React.cache` so multiple Server Components in the same request share one query, and returns `DEFAULT_PREFERENCES` for unauthenticated users or users without a row.

- **Theme** is applied by adding `dark` to `<html>` in `src/app/layout.tsx`. Tailwind v4 uses class-based dark mode via `@custom-variant dark` in `globals.css`. Reading the theme server-side avoids any flash-of-wrong-theme on first paint.
- **List text size** is read in `src/app/lists/[id]/page.tsx` and passed as a `textSize` prop to `ItemList`, which scales the item rows only (the rest of the chrome stays at its normal size).
- **Writes** go through `src/app/settings/actions.ts` and call `revalidatePath('/', 'layout')` so the next render reflects the new preference without a reload.

### Autocomplete is server-driven, populated by a trigger

`user_item_history` is filled by an `AFTER INSERT` trigger on `items` (`bump_item_history`) — never written directly by app code. The list page fetches the user's top ~200 items by `use_count` and passes them as `suggestions` to `ItemList`; filtering happens client-side. Dedupe is case-insensitive via a unique index on `(user_id, lower(name))`.

## Data Model

Four tables in `supabase/migrations/0001_init.sql`:

- `lists` (id, name, owner_id, is_shared, created_at)
- `list_members` (list_id, user_id) — join table for sharing
- `items` (id, list_id, added_by, name, is_checked, created_at)
- `user_item_history` (user_id, name, last_used_at, use_count) — autocomplete source

TypeScript mirrors of these are in `src/lib/types.ts`. Keep them in sync when the schema changes.

Realtime publication includes `items`, `lists`, and `list_members`.

## Conventions

- **No tests yet** — if adding logic that warrants tests, also bring up the test framework choice.
- **`@/...` imports** resolve to `src/...` (Next.js default).
- **Tailwind v4** — uses `@tailwindcss/postcss`; no `tailwind.config.js`.
- **Schema changes** go in a new file under `supabase/migrations/` (do not edit `0001_init.sql`).
