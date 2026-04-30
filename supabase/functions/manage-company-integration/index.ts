import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HUBSPOT_VERIFY_URL = "https://api.hubapi.com/crm/v3/objects/companies?limit=1&properties=name";
const GITHUB_VERIFY_URL = "https://api.github.com/user";

type VerificationStatus = "connected" | "degraded" | "not_configured";

type VerificationResult = {
  connected: boolean;
  status: VerificationStatus;
  error_code: string | null;
  error_message: string | null;
  last_verified_at: string;
  provider_status: number | null;
};

function safeSnippet(value: unknown) {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? {});
  return raw.slice(0, 240);
}

function classifyVerificationFailure(
  integrationId: string,
  httpStatus: number | null,
  body: unknown,
  stage: "verify",
): Omit<VerificationResult, "connected" | "last_verified_at"> {
  const prefix = integrationId === "hubspot" ? "hubspot" : integrationId === "github" ? "github" : integrationId;
  const snippet = safeSnippet(body);
  const normalized = snippet.toLowerCase();

  if (/missing|empty/.test(normalized)) {
    return {
      status: "not_configured",
      error_code: `${prefix}_missing_token`,
      error_message: `${integrationId === "hubspot" ? "HubSpot" : "GitHub"} token is missing`,
      provider_status: httpStatus,
    };
  }

  if (httpStatus === 429 || /rate limit|too many requests/.test(normalized)) {
    return {
      status: "degraded",
      error_code: `${prefix}_rate_limited`,
      error_message: `${integrationId === "hubspot" ? "HubSpot" : "GitHub"} verification was rate limited`,
      provider_status: httpStatus,
    };
  }

  if (httpStatus !== null && httpStatus >= 500) {
    return {
      status: "degraded",
      error_code: `${prefix}_provider_unavailable`,
      error_message: `${integrationId === "hubspot" ? "HubSpot" : "GitHub"} verification is temporarily unavailable`,
      provider_status: httpStatus,
    };
  }

  if (httpStatus === 401 || httpStatus === 403 || /unauthorized|forbidden|bad credentials|authentication/.test(normalized)) {
    if (/scope|permission|resource not accessible by integration|insufficient/.test(normalized)) {
      return {
        status: "degraded",
        error_code: `${prefix}_insufficient_scope`,
        error_message: `${integrationId === "hubspot" ? "HubSpot" : "GitHub"} credentials are missing required permissions`,
        provider_status: httpStatus,
      };
    }

    if (/expired|revoked/.test(normalized)) {
      return {
        status: "degraded",
        error_code: `${prefix}_token_expired`,
        error_message: `${integrationId === "hubspot" ? "HubSpot" : "GitHub"} token is expired or revoked`,
        provider_status: httpStatus,
      };
    }

    if (/integration installation|unsupported token|token type|private app/.test(normalized)) {
      return {
        status: "degraded",
        error_code: `${prefix}_verification_mismatch`,
        error_message: `${integrationId === "hubspot" ? "HubSpot" : "GitHub"} token type does not match the verification flow`,
        provider_status: httpStatus,
      };
    }

    return {
      status: "degraded",
      error_code: `${prefix}_invalid_token`,
      error_message: `${integrationId === "hubspot" ? "HubSpot" : "GitHub"} token is invalid`,
      provider_status: httpStatus,
    };
  }

  return {
    status: "degraded",
    error_code: `${prefix}_${stage}_failed`,
    error_message: `${integrationId === "hubspot" ? "HubSpot" : "GitHub"} verification failed`,
    provider_status: httpStatus,
  };
}

async function verifyCredential(integrationId: string, token: string): Promise<VerificationResult> {
  const last_verified_at = new Date().toISOString();
  const trimmedToken = token.trim();

  if (!trimmedToken) {
    return {
      connected: false,
      status: "not_configured",
      error_code: `${integrationId}_missing_token`,
      error_message: `${integrationId === "hubspot" ? "HubSpot" : "GitHub"} token is missing`,
      last_verified_at,
      provider_status: null,
    };
  }

  const request = integrationId === "hubspot"
    ? {
        url: HUBSPOT_VERIFY_URL,
        headers: { Authorization: `Bearer ${trimmedToken}`, "Content-Type": "application/json" },
      }
    : integrationId === "github"
      ? {
          url: GITHUB_VERIFY_URL,
          headers: {
            Authorization: `Bearer ${trimmedToken}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "duncan-integrations",
          },
        }
      : null;

  if (!request) {
    return {
      connected: true,
      status: "connected",
      error_code: null,
      error_message: null,
      last_verified_at,
      provider_status: null,
    };
  }

  console.log("[manage-company-integration] verifying credential", {
    integrationId,
    url: request.url,
    token_length: trimmedToken.length,
  });

  const res = await fetch(request.url, { headers: request.headers });
  const data = await res.json().catch(() => ({}));

  if (res.ok) {
    console.log("[manage-company-integration] verification passed", {
      integrationId,
      provider_status: res.status,
    });
    return {
      connected: true,
      status: "connected",
      error_code: null,
      error_message: null,
      last_verified_at,
      provider_status: res.status,
    };
  }

  const classified = classifyVerificationFailure(integrationId, res.status, data, "verify");
  console.log("[manage-company-integration] verification failed", {
    integrationId,
    provider_status: res.status,
    error_code: classified.error_code,
    error_message: classified.error_message,
    provider_snippet: safeSnippet(data),
  });

  return {
    connected: false,
    last_verified_at,
    ...classified,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError || !roleData) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { integration_id, api_key, action } = await req.json();

    if (!integration_id) {
      return new Response(JSON.stringify({ error: "integration_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "disconnect") {
      const { error: deleteError } = await supabaseAdmin
        .from("company_integrations")
        .delete()
        .eq("integration_id", integration_id);

      if (deleteError) throw deleteError;

      return new Response(JSON.stringify({ success: true, message: "Integration disconnected" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!api_key) {
      return new Response(JSON.stringify({ error: "api_key is required for connecting" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedApiKey = api_key.trim();
    if (!normalizedApiKey) {
      return new Response(JSON.stringify({ error: "api_key is required for connecting" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[manage-company-integration] normalized token", {
      integrationId: integration_id,
      token_length: normalizedApiKey.length,
      token_prefix: normalizedApiKey.slice(0, 10),
    });

    const verify = await verifyCredential(integration_id, normalizedApiKey);

    // Store plaintext in Supabase Vault; we persist only the secret UUID.
    const { data: vaultSecretId, error: vaultError } = await supabaseAdmin.rpc(
      "set_company_integration_secret",
      { p_integration_id: integration_id, p_plaintext: normalizedApiKey }
    );
    if (vaultError) {
      console.error("[manage-company-integration] vault store failed", vaultError);
      throw vaultError;
    }
    if (!vaultSecretId || typeof vaultSecretId !== "string") {
      console.error("[manage-company-integration] vault returned empty secret id", { vaultSecretId });
      throw new Error("Failed to persist integration secret to vault");
    }

    const now = new Date().toISOString();
    const status = verify.status;

    const { data, error: upsertError } = await supabaseAdmin
      .from("company_integrations")
      .upsert(
        {
          integration_id,
          encrypted_api_key: vaultSecretId as string,
          status,
          updated_by: user.id,
          last_sync: now,
        },
        { onConflict: "integration_id" }
      )
      .select()
      .single();

    if (upsertError) throw upsertError;

    return new Response(JSON.stringify({
      success: true,
      integration: data,
      verification: {
        connected: verify.connected,
        status,
        error_code: verify.error_code,
        error_message: verify.error_message,
        degraded_reason: verify.error_message,
        last_verified_at: verify.last_verified_at,
        provider_status: verify.provider_status,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error managing company integration:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});