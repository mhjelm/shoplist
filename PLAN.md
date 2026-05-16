# Listöversikt: Per-Lista Editpanel

Status: completed 2026-05-16.

## Summary

Listinställningar flyttades till huvudvyn `/lists`. Egna listor har nu en penna i list-raden som öppnar en inline editpanel under raden. Panelen innehåller namnbyte och share-UI. Inne på själva listan är `Redigera` kvar som item-edit för delete/merge av varor.

## Completed changes

- Owner-listor i `/lists` har editpenna; shared-with-me-listor har ingen.
- Endast en inline panel kan vara öppen åt gången.
- Panelen hämtar members/invitees när den öppnas.
- `renameList(listId, name)` uppdaterar listnamn och revaliderar `/lists` och `/lists/[id]`.
- ShareSection återanvänds utan intern edit-mode-gating.
- Listdetaljen hämtar/renderar inte längre share-sektionen.

## Verification

- `npm.cmd test -- ListsView ShareSection`
- `npm.cmd run lint`
