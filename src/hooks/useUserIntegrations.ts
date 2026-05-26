import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export interface UserIntegration {
  id: string;
  user_id: string;
  integration_id: string;
  status: string;
  last_sync: string | null;
  documents_ingested: number;
  created_at: string;
}

export function useUserIntegrations() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["user-integrations", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_integrations")
        .select("id, user_id, integration_id, status, last_sync, documents_ingested, created_at");
      if (error) throw error;
      return (data ?? []) as UserIntegration[];
    },
  });
}

export function useConnectIntegration() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      integrationId,
      apiKey,
    }: {
      integrationId: string;
      apiKey: string;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await supabase.functions.invoke("connect-integration", {
        body: { integration_id: integrationId, api_key: apiKey },
      });
      if (res.error) throw res.error;
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-integrations"] });
    },
  });
}

export function useDisconnectIntegration() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (integrationId: string) => {
      const res = await supabase.functions.invoke("connect-integration", {
        body: { integration_id: integrationId, action: "disconnect" },
      });
      if (res.error) throw res.error;
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-integrations"] });
    },
  });
}
