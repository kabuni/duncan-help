## Plan: remove deleted Azure DevOps work items from Duncan

### What will change
1. **Full-sync reconciliation**
   - Update `sync-azure-work-items` so each project does two Azure queries:
     - the existing recent-items query for fast upserts;
     - a project-wide live ID query for deletion reconciliation.
   - After a successful project-wide query, delete rows from `azure_work_items` for that project where `external_id` is no longer returned by Azure DevOps.
   - Skip deletion for a project if the live-ID query fails, returns an unsafe/truncated response, or cannot identify the project reliably.

2. **Webhook delete handling**
   - Update `azure-devops-webhook` to handle `workitem.deleted` events by deleting the matching database row.
   - Use `external_id` first, and include `project_name` when Azure provides it.
   - Keep existing upsert behavior for `workitem.created`, `workitem.updated`, and restored/revision-style events.

3. **Sync result reporting**
   - Return `records_deleted` from `sync-azure-work-items` along with `records_synced`.
   - Log deletion counts in function output/audit details without changing the database schema unless needed.

4. **Immediate cleanup path**
   - Once implemented, running **Sync DevOps** in Operations will reconcile the table and remove stale deleted stories from the Work Items list.

### Safety rules
- No UI changes.
- No broad database wipe: deletion only happens per project after Azure confirms the current live IDs for that project.
- If Azure is unavailable or the live-ID query fails, the function will upsert recent changes but leave existing rows untouched for that project.
- No changes to `src/integrations/supabase/types.ts` or generated backend client files.

### Files to update
- `supabase/functions/sync-azure-work-items/index.ts`
- `supabase/functions/azure-devops-webhook/index.ts`

### Validation
- Check the function compiles structurally by reviewing TypeScript syntax.
- Trigger or inspect the sync result path so the response includes both synced and deleted counts.
- Confirm Operations continues reading from `azure_work_items` unchanged.