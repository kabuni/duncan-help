## Problem

The weekly exec summary cron did fire and succeed this morning (Mon 6 Jul 2026, 08:00 UK). The email went out to Simon, Nimesh, Patrick, Ellaine, Matt, Parmy, Arzoo, Aashrey and Tim — but **Palash is not in the hard-coded recipient list**, so he never receives the weekly update. Same happened the previous weeks (his address only appears on manual `force` runs he triggered himself).

## Fix

Add `palash@kabuni.com` to the `RECIPIENT_EMAILS` array in `supabase/functions/weekly-exec-summary/index.ts` (lines 20–30), then redeploy the function.

That's the only change — cron schedule, DST gate, dedupe key and Gmail sender are all working correctly.

## Optional follow-up (ask before doing)

If you'd rather not hard-code the list, we can move recipients into a small DB table (e.g. `exec_summary_recipients`) so you/admins can add/remove people from the UI without a code change. Let me know if you want that too.
