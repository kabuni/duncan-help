import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fastApi, withFastApi } from "@/lib/fastApiClient";

export interface CompanyIntegration {
  id: string;
  integration_id: string;
  status: string;
  last_sync: string | null;
  documents_ingested: number | null;
  created_at: string;
  updated_at: string;
}

export function useCompanyIntegrations() {
  return useQuery({
    queryKey: ["company-integrations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_integrations")
        .select("id, integration_id, status, last_sync, documents_ingested, created_at, updated_at");
      if (error) throw error;
      return (data ?? []) as CompanyIntegration[];
    },
  });
}

export function useUpdateCompanyIntegration() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      integrationId,
      apiKey,
      action,
    }: {
      integrationId: string;
      apiKey?: string;
      action?: "disconnect";
    }) => {
      return await withFastApi(
        async () => {
          const res = await supabase.functions.invoke("manage-company-integration", {
            body: { integration_id: integrationId, api_key: apiKey, action },
          });
          if (res.error) throw res.error;
          return res.data;
        },
        () => fastApi("POST", "/integrations/manage-company", {
          integration_id: integrationId,
          api_key: apiKey,
          action,
        }),
      );
    },
    onSuccess: (data, variables) => {
      if (variables.integrationId === "hubspot" || variables.integrationId === "github") {
        const response = data as any;
        const integration = response?.integration ?? response;
        const providerName = variables.integrationId === "hubspot" ? "HubSpot" : "GitHub";
        console.info(`[company-integrations] ${providerName} save confirmation`, {
          requested_integration_id: variables.integrationId,
          returned_integration_id: integration?.integration_id ?? null,
          returned_status: integration?.status ?? null,
          returned_encrypted_api_key_present: typeof integration?.encrypted_api_key === "string" && integration.encrypted_api_key.length > 0,
          verification_status: response?.verification?.status ?? null,
          verification_error_code: response?.verification?.error_code ?? null,
          ...(variables.integrationId === "hubspot"
            ? { saved_key_matches_hubspot: integration?.integration_id === "hubspot" }
            : { saved_key_matches_github: integration?.integration_id === "github" }),
        });
      }
      qc.invalidateQueries({ queryKey: ["company-integrations"] });
    },
  });
}
