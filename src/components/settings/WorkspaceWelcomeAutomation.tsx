import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Mail, CheckCircle2, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface TokenRow {
  google_account_email: string;
  last_polled_at: string | null;
  last_poll_status: string | null;
  last_poll_error: string | null;
  updated_at: string;
}

export default function WorkspaceWelcomeAutomation() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [token, setToken] = useState<TokenRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [recentCount, setRecentCount] = useState<number>(0);

  const refresh = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("workspace_admin_tokens")
      .select("google_account_email, last_polled_at, last_poll_status, last_poll_error, updated_at")
      .limit(1)
      .maybeSingle();
    setToken(data ?? null);
    const { count } = await supabase
      .from("workspace_welcome_log")
      .select("id", { count: "exact", head: true });
    setRecentCount(count ?? 0);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (searchParams.get("workspace_admin_connected") === "true") {
      toast.success("Workspace Super Admin connected.");
      searchParams.delete("workspace_admin_connected");
      setSearchParams(searchParams, { replace: true });
      refresh();
    }
    const err = searchParams.get("workspace_admin_error");
    if (err) {
      const status = searchParams.get("workspace_admin_status");
      const detail = searchParams.get("workspace_admin_detail");
      const base =
        err === "not_super_admin"
          ? "That Google account isn't a Workspace Super Admin (Directory API returned 403)."
          : err === "admin_sdk_disabled"
          ? "Admin SDK API is not enabled in the Google Cloud project that owns this OAuth client. Enable it at console.cloud.google.com → APIs & Services → Library → Admin SDK API."
          : err === "insufficient_scope"
          ? "OAuth token is missing admin.directory.user.readonly. Re-add the scope to the OAuth consent screen and reconnect."
          : err === "unauthorized"
          ? "Google rejected the token (401)."
          : `Connection failed (${err}).`;
      toast.error(base, { description: detail ? `HTTP ${status}: ${decodeURIComponent(detail)}` : undefined, duration: 12000 });
      searchParams.delete("workspace_admin_error");
      searchParams.delete("workspace_admin_status");
      searchParams.delete("workspace_admin_detail");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const connect = async () => {
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("workspace-admin-auth");
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (e: any) {
      toast.error(e.message || "Failed to start OAuth");
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!token) return;
    await supabase
      .from("workspace_admin_tokens")
      .delete()
      .eq("google_account_email", token.google_account_email);
    toast.success("Disconnected.");
    refresh();
  };

  const runNow = async () => {
    setPolling(true);
    try {
      const { data, error } = await supabase.functions.invoke("poll-workspace-new-users");
      if (error) throw error;
      const sent = (data as any)?.sent ?? 0;
      const checked = (data as any)?.checked ?? 0;
      toast.success(`Checked ${checked} users. Sent ${sent} welcome email${sent === 1 ? "" : "s"}.`);
      refresh();
    } catch (e: any) {
      toast.error(e.message || "Poll failed");
    } finally {
      setPolling(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-foreground">
            Sends a welcome email from <span className="font-mono">duncan@kabuni.com</span> to every
            new <span className="font-mono">@kabuni.com</span> Workspace user. Polls the directory
            once an hour.
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {recentCount} user{recentCount === 1 ? "" : "s"} welcomed to date.
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : token ? (
        <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-norman-success" />
            <span className="font-medium">Connected as</span>
            <span className="font-mono text-muted-foreground">{token.google_account_email}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Last poll:{" "}
            {token.last_polled_at
              ? `${new Date(token.last_polled_at).toLocaleString()} — ${token.last_poll_status ?? "—"}`
              : "never run"}
          </div>
          {token.last_poll_error && (
            <div className="text-xs text-destructive flex items-start gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="break-all">{token.last_poll_error}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={runNow} disabled={polling}>
              {polling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Run now
            </Button>
            <Button size="sm" variant="ghost" onClick={disconnect}>
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Button onClick={connect} disabled={connecting} size="sm">
            {connecting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Mail className="h-3.5 w-3.5 mr-1.5" />
            )}
            Connect Workspace Super Admin
          </Button>
          <p className="text-xs text-muted-foreground">
            Sign in with a Google account that has Super Admin rights in the Kabuni Workspace. The
            account is only used to read the user directory.
          </p>
        </div>
      )}
    </div>
  );
}
