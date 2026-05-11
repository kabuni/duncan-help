## Diagnosis

The error `there is no unique or exclusion constraint matching the ON CONFLICT specification` happens when you add an approver to a Planner event.

Inserting into `key_event_approvals` fires the trigger `sync_event_approval_to_inbox`, which mirrors the row into the global `approvals` inbox using:

```sql
ON CONFLICT (source_table, source_id) DO UPDATE ...
```

But the `approvals` table only has one constraint: the primary key on `id`. There is no unique constraint on `(source_table, source_id)`, so Postgres aborts the insert. The error surfaces in the UI as "Couldn't save approver…".

This also means PO mirroring and any other source that uses the same trigger pattern is fragile (it works only because no duplicates have been inserted yet, but any re-trigger would fail the same way).

## Fix

Add a unique constraint so the trigger's upsert resolves correctly.

```sql
-- Remove any pre-existing duplicates first (defensive — should be none)
DELETE FROM public.approvals a
USING public.approvals b
WHERE a.ctid < b.ctid
  AND a.source_table = b.source_table
  AND a.source_id    = b.source_id;

ALTER TABLE public.approvals
  ADD CONSTRAINT approvals_source_unique UNIQUE (source_table, source_id);
```

No frontend changes needed — the existing `EventApprovals` insert path will start working immediately once the constraint exists.

## Verification

1. Open the planner event, add an approver → expect "Approver saved" toast (no error).
2. Confirm a row appears in the Approvals inbox for the assigned approver.
3. Re-saving / updating the same approval row continues to upsert cleanly.
