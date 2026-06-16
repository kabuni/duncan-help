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

export async function startInstagramConnect() {
  const redirectUri = `${window.location.origin}/auth/instagram/callback`;
  const { data, error } = await supabase.functions.invoke("instagram-oauth-start", {
    body: { redirect_uri: redirectUri },
  });
  if (error || (data as any)?.error) {
    toast.error((data as any)?.error || error?.message || "Failed to start OAuth");
    return;
  }
  window.location.href = (data as { url: string }).url;
}
