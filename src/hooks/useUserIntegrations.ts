import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fastApi } from "@/lib/fastApiClient";
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
      return await fastApi("POST", "/integrations/connect", {
        integration_id: integrationId,
        api_key: apiKey,
      });
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
      return await fastApi("POST", "/integrations/connect", {
        integration_id: integrationId,
        action: "disconnect",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-integrations"] });
    },
  });
}
