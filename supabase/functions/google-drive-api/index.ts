import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<{ access_token: string; expires_in: number } | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  return res.json();
}

async function getValidToken(
  supabaseAdmin: any,
  userId: string
): Promise<{ accessToken: string; tokenRow: any; usedFallback: boolean } | null> {
  // First try user's own token, then fall back to any available token (shared resource)
  let usedFallback = false;
  let { data: tokenRow, error } = await supabaseAdmin
    .from("google_drive_tokens")
    .select("*")
    .eq("connected_by", userId)
    .maybeSingle();

  if (!tokenRow) {
    const result = await supabaseAdmin
      .from("google_drive_tokens")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    tokenRow = result.data;
    error = result.error;
    usedFallback = !!tokenRow;
  }

  if (error || !tokenRow) return null;

  const now = new Date();
  const expiry = new Date(tokenRow.token_expiry);

  if (expiry.getTime() - now.getTime() < 5 * 60 * 1000) {
    const clientId = Deno.env.get("GMAIL_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET")!;
    const refreshed = await refreshAccessToken(tokenRow.refresh_token, clientId, clientSecret);
    if (!refreshed) return null;

    const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000);
    await supabaseAdmin
      .from("google_drive_tokens")
      .update({
        access_token: refreshed.access_token,
        token_expiry: newExpiry.toISOString(),
      })
      .eq("id", tokenRow.id);

    return { accessToken: refreshed.access_token, tokenRow: { ...tokenRow, token_expiry: newExpiry.toISOString() }, usedFallback };
  }

  return { accessToken: tokenRow.access_token, tokenRow, usedFallback };
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getDriveHealth(accessToken: string) {
  const headers = { Authorization: `Bearer ${accessToken}` };

  const aboutRes = await fetch(
    "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink),storageQuota",
    { headers }
  );
  const aboutText = await aboutRes.text();
  if (!aboutRes.ok) {
    throw new Error(`Drive account check failed [${aboutRes.status}]: ${aboutText}`);
  }

  const filesRes = await fetch(
    "https://www.googleapis.com/drive/v3/files?pageSize=5&fields=files(id,name,mimeType,modifiedTime)&orderBy=modifiedTime%20desc&q=trashed%20%3D%20false",
    { headers }
  );
  const filesText = await filesRes.text();
  if (!filesRes.ok) {
    throw new Error(`Drive file listing failed [${filesRes.status}]: ${filesText}`);
  }

  return {
    about: JSON.parse(aboutText),
    files: JSON.parse(filesText).files ?? [],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const accessToken = await getValidToken(supabaseAdmin, user.id);
    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: "Google Drive not connected or token expired. Please reconnect." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { action } = body;
    const driveHeaders = { Authorization: `Bearer ${accessToken}` };

    // ─── STATUS ───
    if (action === "status") {
      const { data: tokenRow } = await supabaseAdmin
        .from("google_drive_tokens")
        .select("token_expiry, updated_at")
        .eq("connected_by", user.id)
        .maybeSingle();

      return new Response(
        JSON.stringify({ connected: !!tokenRow }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── DISCONNECT ───
    if (action === "disconnect") {
      await supabaseAdmin.from("google_drive_tokens").delete().eq("connected_by", user.id);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── LIST FILES in a folder ───
    if (action === "list") {
      const { folderId, query: searchQuery, pageToken, pageSize = 100 } = body;

      let q = "trashed = false";
      if (folderId) {
        q += ` and '${folderId}' in parents`;
      }
      if (searchQuery) {
        q += ` and name contains '${searchQuery}'`;
      }

      const params = new URLSearchParams({
        q,
        fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size,parents)",
        pageSize: String(pageSize),
        orderBy: "name",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?${params}`,
        { headers: driveHeaders }
      );
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Drive list failed: ${err}`);
      }

      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── SEARCH by name (find folders/files) ───
    if (action === "search") {
      const { name, mimeType, parentId } = body;
      
      let q = "trashed = false";
      if (name) q += ` and name = '${name}'`;
      if (mimeType) q += ` and mimeType = '${mimeType}'`;
      if (parentId) q += ` and '${parentId}' in parents`;

      const params = new URLSearchParams({
        q,
        fields: "files(id,name,mimeType,modifiedTime,size,parents)",
        pageSize: "50",
      });

      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?${params}`,
        { headers: driveHeaders }
      );
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Drive search failed: ${err}`);
      }

      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── GET FILE CONTENT (export Google Docs/Sheets as text, or download) ───
    if (action === "get_content") {
      const { fileId, mimeType: fileMimeType } = body;
      if (!fileId) throw new Error("fileId is required");

      let content = "";

      // Google Docs → export as plain text
      if (fileMimeType === "application/vnd.google-apps.document") {
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`,
          { headers: driveHeaders }
        );
        if (!res.ok) throw new Error(`Export failed: ${await res.text()}`);
        content = await res.text();
      }
      // Google Sheets → export as CSV
      else if (fileMimeType === "application/vnd.google-apps.spreadsheet") {
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`,
          { headers: driveHeaders }
        );
        if (!res.ok) throw new Error(`Export failed: ${await res.text()}`);
        content = await res.text();
      }
      // Google Slides → export as plain text
      else if (fileMimeType === "application/vnd.google-apps.presentation") {
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`,
          { headers: driveHeaders }
        );
        if (!res.ok) throw new Error(`Export failed: ${await res.text()}`);
        content = await res.text();
      }
      // Binary files (PDF, DOCX, etc.) → download raw bytes and return as text
      else {
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
          { headers: driveHeaders }
        );
        if (!res.ok) throw new Error(`Download failed: ${await res.text()}`);
        
        // For text-like files, return as text
        if (fileMimeType?.startsWith("text/") || fileMimeType === "application/json") {
          content = await res.text();
        } else {
          // For binary, return base64
          const arrayBuffer = await res.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          content = btoa(binary);
          return new Response(
            JSON.stringify({ content, encoding: "base64", mimeType: fileMimeType }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Truncate if too large
      const MAX_CHARS = 80000;
      const truncated = content.length > MAX_CHARS;
      if (truncated) content = content.slice(0, MAX_CHARS);

      return new Response(
        JSON.stringify({ content, truncated, mimeType: fileMimeType }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Google Drive API error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
