import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type MeetingStatus =
  | "awaiting_purpose" | "pending_approval" | "confirmed" | "declined" | "rescheduled";

export interface MeetingRequest {
  id: string;
  sender_name: string;
  sender_email: string;
  gmail_thread_id: string;
  original_email_subject: string | null;
  original_email_body: string;
  purpose: string | null;
  priority: "P1" | "P2" | "P3" | "P4" | null;
  priority_reason: string | null;
  proposed_slot: string | null;
  proposed_slot_end: string | null;
  calendar_event_id: string | null;
  status: MeetingStatus;
  created_at: string;
  updated_at: string;
}

export function useMeetingRequests() {
  return useQuery<MeetingRequest[]>({
    queryKey: ["meeting-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MeetingRequest[];
    },
    refetchInterval: 60_000,
  });
}

export function useConfirmMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      request_id: string;
      action: "approve" | "decline";
      override_start?: string;
      override_end?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("ea-confirm-meeting", {
        body: params,
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["meeting-requests"] });
      toast.success(vars.action === "approve" ? "Meeting confirmed and invite sent" : "Request declined");
    },
    onError: (e: any) => toast.error(e.message || "Action failed"),
  });
}

export function useTriggerPoll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("ea-poll-inbox", { body: {} });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meeting-requests"] });
      toast.success("Inbox polled");
    },
    onError: (e: any) => toast.error(e.message || "Poll failed"),
  });
}
