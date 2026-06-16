import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface InstagramSnapshot {
  id: string;
  ig_business_id: string;
  captured_at: string;
  followers_count: number | null;
  follows_count: number | null;
  media_count: number | null;
  followers_gained_28d: number | null;
  reach_28d: number | null;
  impressions_28d: number | null;
  profile_views_28d: number | null;
  reach_7d: number | null;
  impressions_7d: number | null;
}

export function useInstagramInsights() {
  return useQuery({
    queryKey: ["instagram-insights"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instagram_insights_snapshots")
        .select("*")
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as InstagramSnapshot | null;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useInstagramConnectionStatus() {
  return useQuery({
    queryKey: ["instagram-connection"],
    queryFn: async () => {
      // Visible to admins only via RLS; non-admins simply get [].
      const { data } = await supabase
        .from("instagram_tokens")
        .select("ig_username, ig_business_id, expires_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(1);
      return (data?.[0] as { ig_username: string | null; ig_business_id: string; expires_at: string | null; updated_at: string } | undefined) ?? null;
    },
  });
}

export function useSyncInstagram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("sync-instagram-insights");
      if (error || (data as any)?.error) {
        throw new Error((data as any)?.error || error?.message || "Sync failed");
      }
      return data;
    },
    onSuccess: () => {
      toast.success("Instagram metrics refreshed");
      qc.invalidateQueries({ queryKey: ["instagram-insights"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function startInstagramConnect() {
  const APP_ID = import.meta.env.VITE_META_APP_ID as string | undefined;
  if (!APP_ID) {
    toast.error("Instagram App ID not configured. Set VITE_META_APP_ID.");
    return;
  }
  const redirectUri = `${window.location.origin}/auth/instagram/callback`;
  const scopes = [
    "instagram_basic",
    "instagram_manage_insights",
    "pages_show_list",
    "pages_read_engagement",
    "business_management",
  ].join(",");
  const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  url.searchParams.set("client_id", APP_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes);
  url.searchParams.set("response_type", "code");
  window.location.href = url.toString();
}
