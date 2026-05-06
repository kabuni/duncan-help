import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fastApi, withFastApi } from "@/lib/fastApiClient";
import { toast } from "sonner";

export interface GmailEmail {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  labelIds: string[];
  isUnread: boolean;
}

export interface GmailFullEmail extends GmailEmail {
  to: string;
  cc?: string;
  bcc?: string;
  htmlBody?: string;
  textBody?: string;
}

export interface GmailStatus {
  connected: boolean;
  email?: string;
  lastSync?: string;
  expired?: boolean;
}

async function gmailApi(action: string, body: Record<string, any> = {}) {
  const data = await withFastApi(
    async () => {
      const { data, error } = await supabase.functions.invoke("gmail-api", {
        body: { action, ...body },
      });
      if (error) throw new Error(error.message || "Gmail API error");
      if (data?.error) throw new Error(data.error);
      return data;
    },
    () => fastApi("POST", "/gmail/api", { action, ...body }),
  );
  return data;
}

export function useGmailStatus() {
  return useQuery<GmailStatus>({
    queryKey: ["gmail-status"],
    queryFn: () => gmailApi("status"),
    staleTime: 30_000,
  });
}

export function useGmailConnect() {
  const [loading, setLoading] = useState(false);

  const connect = useCallback(async () => {
    setLoading(true);
    try {
      const data = await withFastApi<{ url?: string }>(
        async () => {
          const { data, error } = await supabase.functions.invoke("gmail-auth");
          if (error) throw error;
          return data;
        },
        () => fastApi("GET", "/gmail/auth"),
      );
      if (data?.url) window.location.href = data.url;
      else throw new Error("No auth URL returned");
    } catch (err: any) {
      toast.error(err.message || "Failed to start Gmail OAuth");
      setLoading(false);
    }
  }, []);

  return { connect, loading };
}

export function useGmailDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => gmailApi("disconnect"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gmail-status"] });
      qc.invalidateQueries({ queryKey: ["gmail-emails"] });
      toast.success("Gmail disconnected");
    },
  });
}

export function useGmailEmails(pageToken?: string) {
  return useQuery({
    queryKey: ["gmail-emails", "list", pageToken],
    queryFn: () => gmailApi("list", { pageToken, maxResults: 25 }),
    staleTime: 60_000,
  });
}

export function useGmailSearch() {
  const [results, setResults] = useState<{ emails: GmailEmail[]; nextPageToken?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (query: string, pageToken?: string) => {
    setLoading(true);
    try {
      const data = await gmailApi("search", { query, pageToken, maxResults: 25 });
      setResults(data);
    } catch (err: any) {
      toast.error(err.message || "Search failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => setResults(null), []);

  return { results, loading, search, clear };
}

export function useGmailReadEmail() {
  return useMutation({
    mutationFn: (messageId: string) => gmailApi("read", { messageId }),
  });
}

export function useGmailReadThread() {
  return useMutation({
    mutationFn: (threadId: string) => gmailApi("read_thread", { threadId, maxMessages: 5 }),
  });
}

export function useGmailSendEmail() {
  return useMutation({
    mutationFn: (params: { to: string; cc?: string; bcc?: string; subject: string; body: string }) =>
      gmailApi("send", params),
    onSuccess: () => toast.success("Email sent successfully!"),
    onError: (err: any) => toast.error(err.message || "Failed to send email"),
  });
}

export function useGmailCreateDraft() {
  return useMutation({
    mutationFn: (params: {
      to: string;
      cc?: string;
      bcc?: string;
      subject: string;
      body: string;
      threadId?: string;
      inReplyTo?: string;
      references?: string;
    }) => gmailApi("create_draft", params),
    onSuccess: (data: any) => {
      toast.success("Draft saved to Gmail", {
        action: data?.draftUrl
          ? { label: "Open", onClick: () => window.open(data.draftUrl, "_blank") }
          : undefined,
      });
    },
    onError: (err: any) => toast.error(err.message || "Failed to create draft"),
  });
}

export interface GmailWritingProfile {
  id: string;
  user_id: string;
  style_summary: string;
  common_phrases: Record<string, string[]>;
  sample_replies: string[];
  tone_metrics: Record<string, any>;
  sample_count: number;
  last_trained_at: string | null;
  auto_draft_enabled: boolean;
  auto_draft_last_run_at: string | null;
  auto_drafts_created_today: number;
  auto_drafts_counter_date: string;
  ceo_briefing_optin: boolean;
  auto_draft_filter_mode: "blacklist" | "whitelist";
  auto_draft_filter_list: string[];
}

export function useGmailAutoDraftFilterUpdate() {
  const qc = useQueryClient();
  return useMutation<void, Error, { mode: "blacklist" | "whitelist"; list: string[] }>({
    mutationFn: async ({ mode, list }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const cleaned = Array.from(
        new Set(
          list
            .map((s) => s.trim().toLowerCase())
            .filter((s) => s.length > 0 && s.length < 200),
        ),
      );
      const { error } = await supabase
        .from("gmail_writing_profiles")
        .upsert(
          { user_id: user.id, auto_draft_filter_mode: mode, auto_draft_filter_list: cleaned } as any,
          { onConflict: "user_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gmail-writing-profile"] });
      toast.success("Auto-draft filter saved");
    },
    onError: (err) => toast.error(err.message || "Failed to save filter"),
  });
}

export function useGmailCEOBriefingOptinToggle() {
  const qc = useQueryClient();
  return useMutation<{ enabled: boolean }, Error, boolean>({
    mutationFn: async (enabled: boolean) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      // Upsert so users without an existing profile can still opt in
      const { error } = await supabase
        .from("gmail_writing_profiles")
        .upsert(
          { user_id: user.id, ceo_briefing_optin: enabled } as any,
          { onConflict: "user_id" },
        );
      if (error) throw error;
      return { enabled };
    },
    onSuccess: ({ enabled }) => {
      qc.invalidateQueries({ queryKey: ["gmail-writing-profile"] });
      toast.success(
        enabled
          ? "Inbox signals will be included in the CEO briefing"
          : "Inbox signals removed from the CEO briefing",
      );
    },
    onError: (err) => toast.error(err.message || "Failed to update setting"),
  });
}

export function useGmailWritingProfile() {
  return useQuery<GmailWritingProfile | null>({
    queryKey: ["gmail-writing-profile"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gmail_writing_profiles")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    staleTime: 60_000,
  });
}

export function useGmailTrainStyle() {
  const qc = useQueryClient();
  return useMutation<any, Error, number | undefined>({
    mutationFn: async (maxResults?: number) => {
      const { data, error } = await supabase.functions.invoke("gmail-train-style", {
        body: { maxResults: maxResults ?? 300 },
      });
      if (error) throw new Error(error.message || "Training failed");
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gmail-writing-profile"] });
      toast.success("Duncan has learned your writing style");
    },
    onError: (err: any) => toast.error(err.message || "Training failed"),
  });
}

export function useGmailDeleteWritingProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("gmail_writing_profiles").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gmail-writing-profile"] });
      toast.success("Writing profile deleted");
    },
  });
}

export function useGmailAutoDraftToggle() {
  const qc = useQueryClient();
  return useMutation<any, Error, boolean>({
    mutationFn: async (enabled: boolean) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      if (enabled) {
        const readiness = await gmailApi("check_auto_draft_ready");
        if (!readiness?.ready) {
          throw new Error(
            readiness?.message || "Gmail needs to be reconnected before Duncan can create drafts.",
          );
        }
      }

      // Upsert so users without an existing profile row can still enable the toggle
      const { error } = await supabase
        .from("gmail_writing_profiles")
        .upsert(
          { user_id: user.id, auto_draft_enabled: enabled } as any,
          { onConflict: "user_id" },
        );
      if (error) throw error;
      return { enabled };
    },
    onSuccess: ({ enabled }) => {
      qc.invalidateQueries({ queryKey: ["gmail-writing-profile"] });
      toast.success(enabled ? "Auto-draft enabled — Duncan will pre-draft replies every 10 min" : "Auto-draft disabled");
    },
    onError: (err) => toast.error(err.message || "Failed to update auto-draft setting"),
  });
}
