import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Loader2, Lock, ArrowRight, CheckCircle } from "lucide-react";
import duncanAvatar from "@/assets/duncan-avatar.jpeg";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { API_BASE_URL } from "@/lib/apiConfig";

const FASTAPI_HEADERS = {
  "Content-Type": "application/json",
  "ngrok-skip-browser-warning": "1",
};

const ResetPassword = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // FastAPI sends reset link as ?token=...
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (t) setToken(t);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (!token) {
      toast.error("Invalid or missing reset token");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/password-reset/confirm`, {
        method: "POST",
        headers: FASTAPI_HEADERS,
        body: JSON.stringify({ token, new_password: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.detail || data?.error || "Failed to update password");
      }
      setSuccess(true);
      toast.success("Password updated successfully");
      setTimeout(() => navigate("/auth"), 2000);
    } catch (error: any) {
      toast.error(error.message || "Failed to update password");
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center">
          <p className="text-muted-foreground text-sm mb-4">Invalid or expired reset link.</p>
          <button
            onClick={() => navigate("/auth")}
            className="text-primary hover:text-primary/80 text-sm font-medium transition-colors"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="flex items-center gap-3 mb-8">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg overflow-hidden">
            <img src={duncanAvatar} alt="Duncan" className="h-full w-full object-cover object-[50%_30%] scale-150" />
          </div>
          <h1 className="text-lg font-bold text-foreground">Duncan</h1>
        </div>

        {success ? (
          <div className="text-center py-8">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-foreground mb-2">Password updated</h2>
            <p className="text-sm text-muted-foreground">Redirecting you to sign in…</p>
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-foreground tracking-tight mb-1">Set new password</h2>
            <p className="text-sm text-muted-foreground mb-8">Enter your new password below.</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">New password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className="w-full rounded-lg border border-border bg-card pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Confirm password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className="w-full rounded-lg border border-border bg-card pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-all"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Update password
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            </form>
          </>
        )}
      </motion.div>
    </div>
  );
};

export default ResetPassword;
