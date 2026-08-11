# RAID Board

Add a RAID board that is an exact replica of the Workstreams board, reachable from a button in the Workstreams header next to the tour button. It shows only cards whose title starts with the word "RAID" (case-insensitive), and is empty when none exist.

## What you'll see

- On `/workstreams`, a new "RAID Board" button sits next to the Replay Tour button.
- Clicking it opens `/workstreams/raid`: same header, KPI overview, filters, Board / List / Tasks toggle, card modal, and create dialog as the main board.
- Heading reads "RAID Board" with a matching subtitle; only RAID cards are counted in the KPI overview and status distribution.
- If no card titles begin with "RAID", the board shows an empty state.
- A "Back to Workstreams" button on the RAID board returns to the main board.

## Technical approach

- `src/pages/Workstreams.tsx`: add an optional `raidOnly?: boolean` prop.
  - Apply a client-side filter after `useWorkstreamCards`: keep cards where `title.trim().toUpperCase().startsWith("RAID")`. Apply the same filter to `allCards` before computing `overview`, so KPIs reflect RAID only.
  - Swap the title/subtitle and the header action buttons based on the flag (RAID board shows "Back to Workstreams" instead of the RAID button).
  - Empty-state copy becomes "No RAID cards yet" on the RAID board.
- `src/App.tsx`: add `<Route path="/workstreams/raid" element={<Workstreams raidOnly />} />`.
- No database, RLS, or hook changes — the RAID board reads the same `workstream_cards` data, so existing visibility rules apply unchanged.

## Assumption

"Tickets that start with RAID" is read as the card **title** starting with RAID (e.g. "RAID – Vendor delay"). If you meant a task code prefix or a tag instead, say so and I'll switch the filter.
