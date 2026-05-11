## Goal
Replace the Category dropdown in the Budget Authorisations (PO) form with these 6 options, in this order:
Events, Marketing, Social, Creative, Manufacturing, Other.

## Changes

### 1. Database migration
Add new values to the `po_category` Postgres enum so the new options can be persisted:
- `events`
- `social`
- `manufacturing`

Legacy values (`software`, `hardware`, `services`, `travel`, `office_supplies`) remain in the enum so existing POs continue to display correctly — they just won't be offered to new submissions.

### 2. `src/components/po/POForm.tsx`
- Replace the `categories` array with the 6 new options in the requested order.
- Update the Zod schema's category enum to `["events", "marketing", "social", "creative", "manufacturing", "other"]`.
- Adjust the default-value logic so the form opens on a valid option (creative dept → `creative`, otherwise `other`).

### 3. `src/hooks/usePurchaseOrders.ts`
Extend the `POCategory` TypeScript union to include the three new values alongside legacy ones, so both new submissions and historical records typecheck.

### 4. Audit other surfaces
Scan for any other UI that renders category labels (lists, filters, badges, exports) and add labels for `events`, `social`, `manufacturing` where needed so they don't render as raw enum strings.

## Out of scope
- Re-categorising existing POs that use retired categories.
- Removing legacy enum values from the database.
