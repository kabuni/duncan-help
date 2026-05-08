import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export type ApprovalKind = "cost" | "event_date" | "release" | "hire" | "contract" | "other";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "changes_requested" | "cancelled";

export interface ApprovalRow {
  id: string;
  kind: ApprovalKind;
  source_table: string;
  source_id: string;
  title: string;
  summary: string | null;
  amount: number | null;
  currency: string | null;
  status: ApprovalStatus;
  requested_by: string | null;
  approver_profile_id: string | null;
  approver_user_id: string | null;
  decision_note: string | null;
  decided_at: string | null;
  due_at: string | null;
  link_path: string | null;
  created_at: string;
  updated_at: string;
}

export function useApprovals() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["approvals", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("approvals" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as unknown as ApprovalRow[]) || [];
    },
  });
}

export function useApprovalCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["approvals-count", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("approvals" as any)
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .eq("approver_user_id", user!.id);
      if (error) throw error;
      return count || 0;
    },
    refetchInterval: 60_000,
  });
}

export function useDecideApproval() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      row,
      status,
      note,
    }: {
      row: ApprovalRow;
      status: "approved" | "rejected";
      note?: string;
    }) => {
      // Mirror decision back into source table so the source remains the truth.
      if (row.source_table === "purchase_orders") {
        if (status === "rejected") {
          const { error } = await supabase
            .from("purchase_orders")
            .update({ status: "rejected", rejection_reason: note || "Rejected" })
            .eq("id", row.source_id);
          if (error) throw error;
        } else {
          // Look up the PO to decide which approver slot the current user fills.
          // Dual sign-off requires both primary + secondary; the DB trigger flips
          // the PO to 'approved' only when both timestamps are set.
          const { data: po, error: fetchErr } = await supabase
            .from("purchase_orders")
            .select("approver_user_id, secondary_approver_user_id")
            .eq("id", row.source_id)
            .single();
          if (fetchErr) throw fetchErr;

          const now = new Date().toISOString();
          const update: any = {};
          if (po.secondary_approver_user_id === user!.id) {
            update.secondary_approved_by = user!.id;
            update.secondary_approved_at = now;
          } else {
            update.approved_by = user!.id;
            update.approved_at = now;
          }
          const { error } = await supabase
            .from("purchase_orders")
            .update(update)
            .eq("id", row.source_id);
          if (error) throw error;
        }

        // Also close out the specific approvals inbox row for this approver,
        // so it moves to "Decided" immediately (the PO sync trigger only
        // mirrors when the PO itself flips status).
        const { error: aErr } = await supabase
          .from("approvals" as any)
          .update({
            status,
            decision_note: note ?? null,
            decided_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (aErr) throw aErr;
      } else if (row.source_table === "key_event_approvals") {
        const { error } = await supabase
          .from("key_event_approvals" as any)
          .update({
            status,
            decision_note: note ?? null,
            decided_at: new Date().toISOString(),
          })
          .eq("id", row.source_id);
        if (error) throw error;
      } else {
        // Generic fallback
        const { error } = await supabase
          .from("approvals" as any)
          .update({
            status,
            decision_note: note ?? null,
            decided_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["approvals-count"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success(vars.status === "approved" ? "Approved" : "Rejected");
    },
    onError: (e: any) => toast.error(e.message),
  });
}
