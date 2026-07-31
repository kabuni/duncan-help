import { supabase } from "@/integrations/supabase/client";

/**
 * Hours Saved engine — client side.
 *
 * Estimated minutes for every Duncan action live in ONE admin-editable
 * configuration table (`public.effort_savings_config`). Nothing here hardcodes
 * a duration: we simply record that a native UI action succeeded and the
 * database resolves the minutes from the lookup table.
 *
 * Only call this AFTER an action has successfully completed. Never call it for
 * cancelled confirmations, failed operations or retries.
 */
export type SavingsActionKey =
  // Workstreams
  | "ui.workstream.create_card"
  | "ui.workstream.update_card"
  | "ui.workstream.find_task"
  | "ui.workstream.assign_users"
  | "ui.workstream.add_subtask"
  | "ui.workstream.add_comment"
  | "ui.workstream.upload_attachment"
  | "ui.workstream.present_view"
  | "ui.workstream.overdue_followup"
  // Planner
  | "ui.planner.create_event"
  | "ui.planner.reschedule_event"
  | "ui.planner.check_availability"
  | "ui.planner.add_rsvp"
  | "ui.planner.calendar_sync"
  // 90 Day Tracker
  | "ui.plan90.update_deliverable"
  | "ui.plan90.add_update"
  | "ui.plan90.find_latest_update"
  | "ui.plan90.presentation";

export async function logSavings(
  actionKey: SavingsActionKey,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    await (supabase as any).rpc("log_savings_event", {
      _action_key: actionKey,
      _metadata: metadata,
    });
  } catch {
    // Metrics must never break a user action.
  }
}
