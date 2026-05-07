import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export type POCategory = "software" | "hardware" | "services" | "marketing" | "travel" | "office_supplies" | "other";
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
  approved_by: string | null;
  approved_at: string | null;
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
      const update: any = {
        status: approved ? "approved" : "rejected",
        approved_by: approved ? user!.id : null,
        approved_at: approved ? new Date().toISOString() : null,
      };
      if (!approved) {
        update.rejection_reason = rejection_reason || "Rejected";
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
