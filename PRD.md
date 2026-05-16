# PRD — Family Shopping List

## Overview

A web app for family members to manage personal and shared grocery lists with real-time collaboration, offline support, and smart item import from recipes and photos.

---

## Stack

| Layer | Tool |
|---|---|
| Frontend | Next.js 16 App Router · React 19 · Tailwind v4 |
| Auth | Supabase Auth (email + password) |
| Database | Supabase Postgres + RLS |
| Realtime | Supabase Realtime |
| AI | Google Gemini 2.5 Flash |
| Image hosting | ImgBB |
| Hosting | Vercel |

---

## Users

- Small group of family members, each with their own account
- No admin role — all members are peers
- Signup is invitation-only (Supabase "Invite user" flow — see pending tasks in CLAUDE.md)

---

## Features

### Authentication
- Sign up / sign in via email + password
- Session persistence across page reloads and app restarts

### Lists
- Create, rename, and delete lists (delete: owner only)
- Share a list by inviting family members by email
- Sharing is derived from `list_members` rows — no `is_shared` flag
- Members can leave a shared list
- Previously-invited emails appear as quick-pick chips in the share UI

### Items

**Adding:**
- Auto-growing textarea with three parsing modes:
  1. Single plain name → instant optimistic insert
  2. Multi-line or comma-separated names (no digits) → deterministic batch split
  3. Input containing quantities/measurements → Gemini extracts `{ name, quantity, measurement, category }` per item
- Autocomplete from the user's personal item history (top 200 by use-count)
- Suggestions come from `user_item_history`, populated by a DB trigger on insert

**Viewing:**
- Items split into two sections: **to shop** (grouped by category) and **shopped** (flat)
- Drag to reorder within a category
- Category section headers shown only when populated

**Actions per item:**
- Tap to check off / uncheck (shopped items move to the shopped section)
- Edit: name, quantity, measurement, category, photo
- Delete (via edit mode)
- Merge two items by dragging one onto another in edit mode (measurements joined, quantities summed)
- Copy or move selected items to another list

**Photos:**
- Upload from camera or gallery (resized client-side, hosted on ImgBB)
- Tap thumbnail in list for a fullscreen lightbox

### Categories
- 11 fixed grocery categories with Swedish labels (see `src/lib/categories.ts`)
- Auto-assigned by Gemini on add; cached in `user_item_history` for future adds of the same item
- Manual override via the edit modal (persists to history)
- User-configurable sort order in Settings (drag-to-reorder)

### Measurements
- Free-form text field (e.g. `½ dl`, `ca 500 g`, `2 förp à 250 g`)
- Multi-segment measurements (e.g. `1 dl + 2 dl`) show a "combine → 3 dl" popover

### Recipe & list import
- **From URL**: fetches server-side, prefers JSON-LD (`recipeIngredient`), falls back to Gemini HTML parse
- **From text**: paste any shopping list or recipe text, Gemini extracts items
- **From image**: pick from gallery, take a photo, or paste from clipboard — Gemini vision extracts items
- Accept/reject screen before adding to list
- Same pipeline used by the in-app modal and the Android share target

### Real-time sync
- Supabase Realtime keeps all open sessions in sync on shared lists
- Add, toggle, edit, delete, reorder all propagate without page refresh

### Offline support
- Full offline-first architecture via IndexedDB (Dexie) — items and lists readable with no connection
- Mutations queue in an outbox; synced automatically on reconnect
- Service worker caches navigation HTML so previously-visited lists open offline
- `OfflineBadge` and disabled affordances signal offline state; new-list creation and sharing require connection

### Android share target (PWA)
- Installed PWA appears in Android's system share sheet
- Accepts shared URLs, text, and images — runs them through the same import pipeline
- Extracted items land on a `/share/[id]` confirmation page before being added to a chosen list

### Settings
- **Theme**: Light · Dark · Shoplist
  - Shoplist: palette from the app icon (pink/teal/orange/yellow/blue), gradient background, frosted-glass header, per-item pastel tints, canvas firework burst when an item is checked off
- **High contrast**: stronger borders and text for accessibility
- **List text size**: Normal · Large (affects item rows only)
- **Category order**: drag-to-reorder the 11 categories

---

## Non-goals

- Push notifications
- Barcode / QR scanning
- Purchase history or spend tracking
- Recurring / template lists
- Admin roles or permissions beyond creator vs. member
- iOS Web Share Target (Safari does not support it)
- Multi-language UI (Swedish labels are hardcoded in category slugs)

---

## Data model (high level)

| Table | Key columns |
|---|---|
| `lists` | id, name, owner_id, created_at |
| `list_members` | list_id, user_id, added_at |
| `items` | id, list_id, added_by, name, is_checked, sort_order, quantity, measurement, category, picture_url |
| `user_item_history` | user_id, name, use_count, last_used_at, category |
| `user_preferences` | user_id, theme, list_text_size, category_order, high_contrast |
| `pending_imports` | id, user_id, items (jsonb), created_at |
