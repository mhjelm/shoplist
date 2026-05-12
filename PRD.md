# PRD — Family Shopping List

## Overview
A web app for family members to manage personal and shared shopping lists with real-time collaboration.

---

## Stack
| Layer | Tool |
|---|---|
| Frontend | Next.js (Vercel) |
| Auth | Supabase Auth |
| Database | Supabase Postgres |
| Realtime | Supabase Realtime |
| Hosting | Vercel (free tier) |

---

## Users
- Small group of family members, each with their own account
- No admin role for now — all members are peers

---

## Features

### Authentication
- Sign up / sign in via email + password (Supabase Auth)
- Session persistence across page reloads

### Lists
- Each user can create **private** or **shared** lists
- **Private lists** — only visible and accessible to the creator
- **Shared lists** — creator invites specific family members by email/username
- Any member can create and share a list
- Only the **creator** can delete a list
- Members can leave a shared list

### Items
- Flat list — no categories, no quantity, no notes
- Any member with access can **add** an item
- Any member with access can **check off** an item (marks it done, stays visible with visual distinction)
- **"Delete checked"** is a separate explicit action — removes all checked items at once
- No history — deleted items are gone permanently

### Real-time Sync
- Changes on shared lists (add, check, delete checked) reflect instantly for all members without page refresh
- Private lists don't require realtime but should feel snappy

### Autocomplete
- When typing a new item, suggestions appear from the user's **personal history** of all items they've ever added, across all lists
- Purely local to the user — not shared across family members

---

## Non-goals (for now)
- Quantity / units
- Item notes
- Categories / grouping
- Purchase history
- PWA / offline support
- Push notifications
- Admin roles or permissions beyond creator/member

---

## Data Model (high level)

**users** — managed by Supabase Auth

**lists**
- id, name, owner_id, is_shared, created_at

**list_members**
- list_id, user_id (join table for shared list access)

**items**
- id, list_id, added_by, name, is_checked, created_at

**user_item_history**
- user_id, item_name (distinct — for autocomplete, deduped per user)

---

## Open Questions
None — ready to build.
