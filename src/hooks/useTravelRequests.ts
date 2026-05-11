import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export type TravelStatus = "pending_approval" | "approved" | "rejected" | "cancelled";
export type TravelTransport = "flight" | "train" | "car" | "other";

export interface TravelRequest {
  id: string;
  reference: string;
  requester_id: string;
  traveller_user_id: string | null;
  traveller_name: string;
  purpose: string;
  destination_city: string;
  destination_country: string;
  depart_date: string;
  return_date: string;
  transport_mode: TravelTransport;
  accommodation_needed: boolean;
  estimated_cost: number;
  currency: string;
  notes: string | null;
  attachment_path: string | null;
  status: TravelStatus;
  approver_user_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export function useTravelRequests() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["travel-requests", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("travel_requests" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as unknown as TravelRequest[]) || [];
    },
  });
}

export function useCreateTravelRequest() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      traveller_name: string;
      traveller_user_id?: string | null;
      purpose: string;
      destination_city: string;
      destination_country: string;
      depart_date: string;
      return_date: string;
      transport_mode: TravelTransport;
      accommodation_needed: boolean;
      estimated_cost: number;
      currency?: string;
      notes?: string | null;
      attachment_path?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("travel_requests" as any)
        .insert({
          ...input,
          currency: input.currency || "GBP",
          requester_id: user!.id,
          reference: "",
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as TravelRequest;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["travel-requests"] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
      toast.success("Travel request submitted");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useCancelTravelRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("approvals" as any).delete()
        .eq("source_table", "travel_requests").eq("source_id", id);
      const { error } = await supabase.from("travel_requests" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["travel-requests"] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
      toast.success("Travel request deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useTravelApproverSetting() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["app-setting", "travel_approver"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings" as any)
        .select("*")
        .eq("key", "travel_approver")
        .maybeSingle();
      if (error) throw error;
      return (data as any) || null;
    },
  });
  const save = useMutation({
    mutationFn: async (approver_user_id: string) => {
      const { error } = await supabase
        .from("app_settings" as any)
        .upsert({
          key: "travel_approver",
          value: { travel_approver_user_id: approver_user_id },
          updated_at: new Date().toISOString(),
        } as any, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-setting", "travel_approver"] });
      toast.success("Travel approver updated");
    },
    onError: (e: any) => toast.error(e.message),
  });
  return { ...query, save };
}
