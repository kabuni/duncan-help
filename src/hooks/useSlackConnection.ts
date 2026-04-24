import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface SlackConnection {
  id: string;
  user_id: string;
  team_id: string;
  team_name: string | null;
  authed_user_id: string | null;
  scope: string | null;
  user_scope: string | null;
  user_token_type: string | null;
  created_at: string;
  updated_at: string;
}

async function invokeSlack<T>(functionName: string, body?: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) throw new Error(error.message || `${functionName} failed`);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export function useSlackConnection() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["slack-connection"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("slack_connections")
        .select("id, user_id, team_id, team_name, authed_user_id, scope, user_scope, user_token_type, created_at, updated_at")
        .maybeSingle();

      if (error) throw error;
      return data as SlackConnection | null;
    },
    staleTime: 30_000,
  });

  const connect = useCallback(async () => {
    const data = await invokeSlack<{ url?: string }>("slack-auth");
    if (!data?.url) throw new Error("No Slack authorization URL returned");
    window.location.href = data.url;
  }, []);

  const disconnectMutation = useMutation({
    mutationFn: () => invokeSlack<{ success: boolean }>("slack-disconnect"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["slack-connection"] });
      toast.success("Slack disconnected");
    },
    onError: (error) => toast.error(error.message || "Failed to disconnect Slack"),
  });

  return {
    connection: query.data ?? null,
    isConnected: !!query.data,
    workspaceName: query.data?.team_name ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    connect,
    disconnect: () => disconnectMutation.mutateAsync(),
    isDisconnecting: disconnectMutation.isPending,
    refetch: query.refetch,
  };
}
