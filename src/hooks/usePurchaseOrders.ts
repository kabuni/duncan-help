import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export type POCategory = "events" | "marketing" | "social" | "creative" | "manufacturing" | "other" | "software" | "hardware" | "services" | "travel" | "office_supplies";
export type POStatus = "draft" | "pending_approval" | "approved" | "rejected" | "cancelled";

export interface PurchaseOrder {
  id: string;
  po_number: string;
  requester_id: string;
  department_id: string;
  vendor_name: string;
  description: string;
  category: POCategory;
  quantity: number;
  unit_price: number;
  total_amount: number;
  delivery_date: string | null;
  status: POStatus;
  approval_tier: string | null;
  approver_user_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  secondary_approver_user_id: string | null;
  secondary_approved_by: string | null;
  secondary_approved_at: string | null;
  rejection_reason: string | null;
  attachment_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function usePurchaseOrders() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["purchase-orders", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as PurchaseOrder[];
    },
  });
}

export function useCreatePO() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (po: {
      department_id: string;
      vendor_name: string;
      description: string;
      category: POCategory;
      quantity: number;
      unit_price: number;
      total_amount: number;
      delivery_date?: string;
      attachment_path?: string;
      notes?: string;
      approver_user_id?: string;
      secondary_approver_user_id?: string;
    }) => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .insert({
          ...po,
          requester_id: user!.id,
          po_number: "", // trigger will generate
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      const statusMsg = data.status === "approved" ? "Auto-approved (under £500)" : "Submitted for approval";
      toast({ title: "PO Created", description: `${data.po_number} — ${statusMsg}` });
      // Notify approvers by email (fire-and-forget)
      if (data.status === "pending_approval") {
        supabase.functions.invoke("send-po-approval-email", { body: { po_id: data.id } })
          .catch((e) => console.error("send-po-approval-email failed", e));
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

export function useApprovePO() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, approved, rejection_reason }: { id: string; approved: boolean; rejection_reason?: string }) => {
      // Look up the PO to decide which approver slot the current user fills
      const { data: po, error: fetchErr } = await supabase
        .from("purchase_orders")
        .select("approver_user_id, secondary_approver_user_id, approved_at, secondary_approved_at")
        .eq("id", id)
        .single();
      if (fetchErr) throw fetchErr;

      const update: any = {};
      const now = new Date().toISOString();

      if (!approved) {
        update.status = "rejected";
        update.rejection_reason = rejection_reason || "Rejected";
      } else if (po.approver_user_id === user!.id) {
        update.approved_by = user!.id;
        update.approved_at = now;
      } else if (po.secondary_approver_user_id === user!.id) {
        update.secondary_approved_by = user!.id;
        update.secondary_approved_at = now;
      } else {
        // Fallback: admin override fills primary slot
        update.approved_by = user!.id;
        update.approved_at = now;
      }

      const { error } = await supabase.from("purchase_orders").update(update).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      toast({ title: "PO Updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

export function useUpdatePO() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<PurchaseOrder> & { id: string }) => {
      const { error } = await supabase.from("purchase_orders").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      toast({ title: "Request updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

export function useCancelPO() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      // Remove related approvals inbox rows first (no FK cascade).
      await supabase.from("approvals" as any).delete().eq("source_table", "purchase_orders").eq("source_id", id);
      const { error } = await supabase.from("purchase_orders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
      toast({ title: "Request deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}
