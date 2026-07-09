import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface EmailApproval {
  id: string;
  user_id: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  sender_email: string;
  sender_name: string | null;
  subject: string | null;
  incoming_snippet: string | null;
  incoming_summary: string | null;
  proposed_reply: string;
  ai_confidence: number | null;
  risk_flags: string[] | null;
  status: "pending" | "sent" | "edited" | "discarded" | "expired";
  created_at: string;
}

export interface OutboxItem {
  id: string;
  sender_email: string;
  subject: string | null;
  body: string;
  status: "queued" | "sent" | "undone" | "failed";
  send_after: string;
  created_at: string;
}

export interface SenderTrust {
  id: string;
  sender_email: string;
  sender_domain: string | null;
  sends_approved: number;
  sends_edited: number;
  sends_rejected: number;
  confidence: number;
  auto_send_enabled: boolean;
  force_trust: boolean;
  force_review: boolean;
  last_updated: string;
}

export function usePendingApprovals() {
  return useQuery<EmailApproval[]>({
    queryKey: ["email-approvals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("gmail_pending_approvals")
        .select("*").eq("status", "pending").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as EmailApproval[];
    },
    refetchInterval: 30_000,
  });
}

export function useQueuedOutbox() {
  return useQuery<OutboxItem[]>({
    queryKey: ["email-outbox"],
    queryFn: async () => {
      const { data, error } = await supabase.from("gmail_auto_outbox")
        .select("*").eq("status", "queued").order("send_after", { ascending: true });
      if (error) throw error;
      return (data ?? []) as OutboxItem[];
    },
    refetchInterval: 15_000,
  });
}

export function useSenderTrust() {
  return useQuery<SenderTrust[]>({
    queryKey: ["sender-trust"],
    queryFn: async () => {
      const { data, error } = await supabase.from("gmail_sender_trust")
        .select("*").order("last_updated", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as SenderTrust[];
    },
    staleTime: 60_000,
  });
}

export function useDecideApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      approval_id: string;
      action: "approve" | "edit" | "discard";
      edited_body?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("gmail-approval-decide", {
        body: params,
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["email-approvals"] });
      qc.invalidateQueries({ queryKey: ["sender-trust"] });
      const label = vars.action === "approve" ? "Sent" : vars.action === "edit" ? "Edited and sent" : "Discarded";
      toast.success(label);
    },
    onError: (e: any) => toast.error(e.message || "Decision failed"),
  });
}

export function useUndoOutbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (outbox_id: string) => {
      const { data, error } = await supabase.functions.invoke("gmail-approval-decide", {
        body: { action: "undo", outbox_id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-outbox"] });
      qc.invalidateQueries({ queryKey: ["email-approvals"] });
      toast.success("Auto-send cancelled — moved to review");
    },
    onError: (e: any) => toast.error(e.message || "Undo failed"),
  });
}

export function useToggleSenderTrust() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; force_trust?: boolean; force_review?: boolean }) => {
      const update: any = {};
      if (params.force_trust !== undefined) update.force_trust = params.force_trust;
      if (params.force_review !== undefined) update.force_review = params.force_review;
      const { error } = await supabase.from("gmail_sender_trust")
        .update(update).eq("id", params.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sender-trust"] }),
  });
}
