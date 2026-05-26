import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Loader2, Mail, Lock, User, ArrowRight, Building2, Briefcase } from "lucide-react";
import duncanAvatar from "@/assets/duncan-avatar.jpeg";
import { supabase } from "@/integrations/supabase/client";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const ROLE_TITLES = [
  "Developer",
  "Designer",
  "Project Manager",
  "Operations Manager",
  "HR Manager",
  "Finance Manager",
  "Marketing Manager",
  "Sales Manager",
  "Business Analyst",
  "Data Analyst",
  "QA Engineer",
  "DevOps Engineer",
  "Product Manager",
  "Content Strategist",
  "Executive",
  "Other",
];

const Auth = () => {
  const { session, loading } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [department, setDepartment] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showSignupSuccess, setShowSignupSuccess] = useState(false);
  const [resetEmail, setResetEmail] = useState("");

  useEffect(() => {
    supabase.from("departments").select("id, name").order("name").then(({ data }) => {
      if (data) setDepartments(data);
    });
  }, []);

  const getAuthErrorMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : String((error as any)?.message ?? error ?? "");
    if (message.toLowerCase().includes("failed to fetch")) {
      return "Can't reach authentication service from this browser. Check VPN/firewall/ad-blockers or try another network.";
    }
    return message || "Authentication failed";
  };

  const withRetry = async <T,>(request: () => Promise<T>, retries = 1): Promise<T> => {
    try {
      return await request();
    } catch (error) {
      if (retries > 0 && String((error as any)?.message ?? error).toLowerCase().includes("failed to fetch")) {
        return withRetry(request, retries - 1);
      }
      throw error;
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (session && !showSignupSuccess) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const { error } = isLogin
        ? await withRetry(() => supabase.auth.signInWithPassword({ email, password }))
        : await withRetry(() =>
            supabase.auth.signUp({
              email,
              password,
              options: {
                data: {
                  display_name: displayName,
                  department: department,
                  role_title: roleTitle,
                },
                emailRedirectTo: window.location.origin,
              },
            })
          );

      if (error) throw error;

      if (isLogin) {
        toast.success("Welcome back to Duncan");
      } else {
        setShowSignupSuccess(true);
        setIsLogin(true);
        setPassword("");
      }
    } catch (error: unknown) {
      console.error("Auth submit failed", { error, online: navigator.onLine, origin: window.location.origin });
      toast.error(getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { error } = await withRetry(() =>
        supabase.auth.resetPasswordForEmail(resetEmail, {
          redirectTo: `${window.location.origin}/reset-password`,
        })
      );
      if (error) throw error;
      toast.success("Check your email for a password reset link");
      setShowForgotPassword(false);
    } catch (error: unknown) {
      console.error("Password reset request failed", { error, online: navigator.onLine, origin: window.location.origin });
      toast.error(getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] bg-background">
      {/* Left - branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center items-center relative overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div className="absolute inset-0 gradient-radial" />
        <div className="relative z-10 text-center px-12">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex h-20 w-20 mx-auto items-center justify-center rounded-2xl overflow-hidden border border-primary/20 glow-primary mb-8"
          >
            <img src={duncanAvatar} alt="Duncan" className="h-full w-full object-cover object-[50%_30%] scale-150" />
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl font-bold text-foreground tracking-tight mb-3"
          >
            Duncan
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="text-sm font-mono uppercase tracking-widest text-muted-foreground mb-6"
          >
            Internal Operating System
          </motion.p>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-muted-foreground text-sm max-w-sm"
          >
            The reasoning brain that connects your tools, ingests your data, and drives intelligent automation.
          </motion.p>
        </div>
      </div>

      {/* Right - form */}
      <div className="flex-1 flex items-center justify-center px-5 sm:px-8 py-8 sm:py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm"
        >
          {/* Mobile logo */}
          <div className="lg:hidden flex flex-col items-center gap-2 mb-6 sm:mb-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl overflow-hidden border border-primary/20 glow-primary-sm">
              <img src={duncanAvatar} alt="Duncan" className="h-full w-full object-cover object-[50%_30%] scale-150" />
            </div>
            <h1 className="text-xl font-bold text-foreground">Duncan</h1>
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Internal Operating System
            </p>
          </div>

          <h2 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight mb-1 text-center lg:text-left">
            {isLogin ? "Welcome back" : "Join Duncan"}
          </h2>
          <p className="text-sm text-muted-foreground mb-6 sm:mb-8 text-center lg:text-left">
            {isLogin ? "Sign in to your account" : "Create your team account"}
          </p>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {!isLogin && (
              <>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Display name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your name"
                      required
                      className="w-full rounded-lg border border-border bg-card pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 focus:glow-primary-sm transition-all"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Department</label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                    <select
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      required
                      className="w-full rounded-lg border border-border bg-card pl-10 pr-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/40 transition-all appearance-none"
                    >
                      <option value="" disabled>Select department</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.name}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Role</label>
                  <div className="relative">
                    <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                    <select
                      value={roleTitle}
                      onChange={(e) => setRoleTitle(e.target.value)}
                      required
                      className="w-full rounded-lg border border-border bg-card pl-10 pr-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/40 transition-all appearance-none"
                    >
                      <option value="" disabled>Select role</option>
                      {ROLE_TITLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  className="w-full rounded-lg border border-border bg-card pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 focus:glow-primary-sm transition-all"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full rounded-lg border border-border bg-card pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 focus:glow-primary-sm transition-all"
                />
              </div>
            </div>

            {isLogin && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(true)}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  Forgot password?
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-all"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {isLogin ? "Sign in" : "Create account"}
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </form>

          {!isLogin && (
            <p className="mt-3 text-xs text-muted-foreground/60 text-center">
              Your account will need admin approval before you can access Duncan.
            </p>
          )}

          {showForgotPassword && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
              onClick={() => setShowForgotPassword(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full max-w-sm mx-4 rounded-xl border border-border bg-card p-6 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-lg font-bold text-foreground mb-1">Reset password</h3>
                <p className="text-sm text-muted-foreground mb-5">
                  Enter your email and we'll send you a reset link.
                </p>
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                    <input
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="you@company.com"
                      required
                      className="w-full rounded-lg border border-border bg-card pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 transition-all"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowForgotPassword(false)}
                      className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-all"
                    >
                      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send link"}
                    </button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}

          {showSignupSuccess && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
              onClick={() => setShowSignupSuccess(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full max-w-sm mx-4 rounded-xl border border-border bg-card p-6 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-lg font-bold text-foreground mb-2">Check your email</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  We sent a verification link to <span className="font-medium text-foreground">{email}</span>.
                </p>
                <p className="text-sm text-muted-foreground mb-5">
                  Verify your email first, then wait for an admin to approve your profile before you can access Duncan.
                </p>
                <button
                  type="button"
                  onClick={() => setShowSignupSuccess(false)}
                  className="w-full rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:bg-primary/90 transition-all"
                >
                  Got it
                </button>
              </motion.div>
            </motion.div>
          )}

          <p className="mt-6 text-center text-xs text-muted-foreground">
            {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-primary hover:text-primary/80 font-medium transition-colors"
            >
              {isLogin ? "Sign up" : "Sign in"}
            </button>
          </p>
        </motion.div>
      </div>
    </div>
  );
};

export default Auth;
