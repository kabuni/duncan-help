import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type CallbackState = "loading" | "success" | "error";

export default function SlackCallback() {
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<CallbackState>("loading");
  const [message, setMessage] = useState("Connecting Slack…");

  useEffect(() => {
    let active = true;

    const finishOAuth = async () => {
      const oauthError = searchParams.get("error");
      const code = searchParams.get("code");
      const oauthState = searchParams.get("state");

      if (oauthError) {
        setState("error");
        setMessage(`Slack authorization failed: ${oauthError}`);
        return;
      }

      if (!code || !oauthState) {
        setState("error");
        setMessage("Slack authorization response was missing required parameters.");
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke("slack-oauth-callback", {
          body: { code, state: oauthState },
        });

        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);

        if (!active) return;
        setState("success");
        setMessage("Slack connected successfully.");
      } catch (error: any) {
        if (!active) return;
        setState("error");
        setMessage(error.message || "Slack connection failed.");
      }
    };

    finishOAuth();
    return () => {
      active = false;
    };
  }, [searchParams]);

  const Icon = state === "loading" ? Loader2 : state === "success" ? CheckCircle2 : AlertCircle;

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-lg">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
          <Icon className={`h-6 w-6 ${state === "loading" ? "animate-spin text-primary" : state === "success" ? "text-norman-success" : "text-destructive"}`} />
        </div>
        <h1 className="text-lg font-semibold text-foreground">Slack OAuth</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        {state !== "loading" && (
          <Link
            to={state === "success" ? "/integrations?slack_connected=true" : "/integrations?slack_error=callback_failed"}
            className="mt-5 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Back to Integrations
          </Link>
        )}
      </section>
    </main>
  );
}
