# Plan: Fix "create list → back lands on wrong page" via server-side `redirect()`

## Context

Diagnostic logs (kept in `HistoryDebug.tsx`, `CreateListForm.tsx`, `BackLink.tsx`) confirmed the cause beyond doubt:

- **First create** of the session: `[hist] pushState → /lists/<id>` — works correctly, back lands on `/lists`.
- **Second create** (after visiting + backing out of any other list): `[hist] replaceState → /lists/<id>` — `router.push` was silently **demoted to `replaceState`**. The `/lists` entry got overwritten in history, so back jumped over `/lists` straight to whatever was before it (`/settings`, another list, …).

Why it happens: once a `/lists/[id]` RSC payload is in Next.js's router cache (kept for 30 s by `experimental.staleTimes.dynamic` in `next.config.ts`), the App Router treats a subsequent `router.push(\`/lists/<newId>\`)` from `/lists` as a "same dynamic-segment param swap" and uses `replaceState` instead of `pushState`. The form-action + React 19 transition wrapping likely contributes but the cache is the actual trigger.

## Approach

Move the navigation server-side via `redirect()` from `next/navigation`. A server-side redirect always results in a real history push, regardless of router cache state or transition wrapping. Pure root-cause fix — no scroll-locks, no setTimeout hacks.

We do **not** change the existing `createList` server action: `TargetListModal` (`src/app/lists/[id]/TargetListModal.tsx:52`) calls it to obtain the returned `list.id` for the copy/move flow and does **not** want a navigation. Instead, add a thin `createListAndOpen` wrapper.

## Files to modify

### 1. `src/app/lists/actions.ts` — add the wrapper

```ts
import { redirect } from 'next/navigation'

export async function createListAndOpen(formData: FormData) {
  const result = await createList(formData)
  if (result.error || !result.list) {
    return { error: result.error ?? 'Listan skapades, men kunde inte öppnas automatiskt.' }
  }
  redirect(`/lists/${result.list.id}`) // throws NEXT_REDIRECT — never returns
}
```

The existing `createList` stays untouched (still returns `{ list }` / `{ error }`).

### 2. `src/app/lists/CreateListForm.tsx` — switch to the wrapper, drop `router.push`

```diff
- import { useRouter } from 'next/navigation'
- import { createList } from './actions'
+ import { createListAndOpen } from './actions'

  export default function CreateListForm() {
-   const router = useRouter()
    const [open, setOpen] = useState(false)
    ...

    async function handleSubmit(formData: FormData) {
      if (isOffline) return
      setError(null)
      setLoading(true)
-     const result = await createList(formData)
+     const result = await createListAndOpen(formData)
+     // Reached only on error — redirect() throws + navigates on success.
      setLoading(false)
-     if (result?.error) {
-       setError(result.error)
-     } else if (result?.list?.id) {
-       console.log('[create] before push', location.pathname, 'len:', history.length)
-       router.push(`/lists/${result.list.id}`)
-       queueMicrotask(() => console.log(...))
-       requestAnimationFrame(() => console.log(...))
-     } else {
-       setError('Listan skapades, men kunde inte öppnas automatiskt.')
-     }
+     if (result?.error) setError(result.error)
    }
```

The `[create] before/after push` diagnostic logs go away with the `router.push` call — they're meaningless once the redirect handles navigation.

## Files NOT to modify

- `src/app/lists/[id]/TargetListModal.tsx` — continues to use `createList`.
- `src/components/HistoryDebug.tsx` and the `[back] …` log in `BackLink.tsx` — **keep for verification**. Rip them out in a separate cleanup commit after confirming the fix on-device.
- `next.config.ts` — `staleTimes.dynamic: 30` stays (it's what makes back-nav from a list fast; we just stop relying on `router.push` working through it).

## Verification

Build prod: `npm run build && npm run start`. Open Chrome DevTools console.

1. Navigate `/settings` → `/lists`.
2. Open an existing list (any list), press back to `/lists`. This is the critical step that warms the router cache and triggers the original bug.
3. Tap **+ New list**, type a name, submit.
4. **Expected logs** (the key change):
   - `[hist] pushState → /lists/<newId> len: NN` ← **must be pushState, not replaceState**
5. Tap ← on the new list.
6. **Expected**: lands on `/lists`. Console shows `[hist] popstate → /lists`.

Then verify `TargetListModal` still works:
- On a list with items, enter edit mode → select items → tap Copy or Move → "Skapa ny lista". Items must end up in the new list, and the user must stay on the current list (no redirect).

`npm test` should still pass at 412/412. No tests cover `createList` directly so this is a pure manual verification.

## Cleanup (separate follow-up commit, after the fix is confirmed working)

- Delete `src/components/HistoryDebug.tsx`.
- Remove the `HistoryDebug` import + `<HistoryDebug />` mount from `src/app/layout.tsx`.
- Remove the `[back] …` `console.log` from `src/app/lists/[id]/BackLink.tsx`.

## Risks

- **`redirect()` from a server action called via `await` in a client function**: documented and supported. Next.js's action infrastructure intercepts the thrown `NEXT_REDIRECT` and turns it into a real navigation. If it doesn't work, the symptom would be a propagated error visible in the console (and potentially an error boundary) — easy to catch in step 4.
- **Loading state lingers on success**: `setLoading(false)` after `await createListAndOpen` never runs on the success branch (the redirect throws past it). The "Create" button stays disabled until the page navigates — visually fine, the navigation kicks off immediately.
- **TargetListModal regression**: zero by construction — that file is not edited.

## Out of scope

- The back-from-list scroll-jump (see "Known issues" in `CLAUDE.md`).
- Reducing `staleTimes.dynamic` (would re-introduce the back-nav slowness we just fixed).
- Refactoring the form to `useActionState` — the wrapper is enough.
