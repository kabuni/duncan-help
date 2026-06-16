import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function InstagramCallback() {
  const navigate = useNavigate();
  const ran = useRef(false);
  const [msg, setMsg] = useState("Connecting Instagram…");

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const error = params.get("error_description") || params.get("error");
      if (error) {
        toast.error(`Instagram connection failed: ${error}`);
        navigate("/settings", { replace: true });
        return;
      }
      if (!code) {
        toast.error("Missing authorization code");
        navigate("/settings", { replace: true });
        return;
      }
      const redirectUri = `${window.location.origin}/auth/instagram/callback`;
      const { data, error: invErr } = await supabase.functions.invoke("instagram-oauth-callback", {
        body: { code, redirect_uri: redirectUri },
      });
      if (invErr || (data as any)?.error) {
        const detail = (data as any)?.error || invErr?.message || "Unknown error";
        toast.error(`Instagram connection failed: ${detail}`);
      } else {
        toast.success(`Instagram connected: @${(data as any)?.ig_username || "account"}`);
      }
      setMsg("Redirecting…");
      navigate("/settings", { replace: true });
    })();
  }, [navigate]);

  return (
    <div className="min-h-[100dvh] flex items-center justify-center text-sm text-muted-foreground gap-2">
      <Loader2 className="h-4 w-4 animate-spin" /> {msg}
    </div>
  );
}
