import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Check, Loader2, Mail, Calendar, Sparkles, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useGmailStatus, useGmailConnect } from "@/hooks/useGmailIntegration";
import { useGoogleCalendar } from "@/hooks/useGoogleCalendar";
import { supabase } from "@/integrations/supabase/client";
import PersonalizationForm from "@/components/profile/PersonalizationForm";
import duncanAvatar from "@/assets/duncan-avatar.jpeg";
import { toast } from "sonner";

type Step = "welcome" | "integrations" | "personalization" | "done";
const STEPS: Step[] = ["welcome", "integrations", "personalization", "done"];

export default function Onboarding() {
  const { session, loading: authLoading, signOut } = useAuth();
  const { profile, isLoading: profileLoading } = useProfile();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("welcome");
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    if (profile?.onboarding_step && STEPS.includes(profile.onboarding_step as Step)) {
      setStep(profile.onboarding_step as Step);
    }
  }, [profile?.onboarding_step]);

  const persistStep = async (next: Step) => {
    setStep(next);
    if (!session?.user) return;
    await supabase.from("profiles").update({ onboarding_step: next }).eq("user_id", session.user.id);
  };

  const completeOnboarding = async () => {
    if (!session?.user) return;
    setCompleting(true);
    const { error } = await supabase
      .from("profiles")
      .update({ onboarding_step: "done", onboarding_completed_at: new Date().toISOString() })
      .eq("user_id", session.user.id);
    setCompleting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate("/", { replace: true });
  };

  if (authLoading || profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!session) return <Navigate to="/auth" replace />;
  if (profile && profile.approval_status !== "approved") return <Navigate to="/" replace />;
  if (profile && profile.onboarding_completed_at) return <Navigate to="/" replace />;

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="pointer-events-none fixed inset-0 gradient-radial opacity-60 z-0" />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg overflow-hidden border border-primary/20">
            <img src={duncanAvatar} alt="Duncan" className="h-full w-full object-cover object-[50%_30%] scale-150" />
          </div>
          <span className="text-sm font-semibold text-foreground tracking-tight">Duncan</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-1.5">
            {STEPS.slice(0, 3).map((s, i) => (
              <div
                key={s}
                className={`h-1 w-8 rounded-full transition-colors ${
                  i <= stepIndex ? "bg-primary" : "bg-border"
                }`}
              />
            ))}
          </div>
          <button
            onClick={signOut}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="relative z-10 flex-1 flex items-start sm:items-center justify-center px-6 py-8">
        <div className="w-full max-w-xl">
          <AnimatePresence mode="wait">
            {step === "welcome" && (
              <StepWelcome key="welcome" onNext={() => persistStep("integrations")} />
            )}
            {step === "integrations" && (
              <StepIntegrations
                key="integrations"
                onBack={() => persistStep("welcome")}
                onNext={() => persistStep("personalization")}
              />
            )}
            {step === "personalization" && (
              <StepPersonalization
                key="personalization"
                onBack={() => persistStep("integrations")}
                onNext={completeOnboarding}
                completing={completing}
              />
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function fade(delay = 0) {
  return {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.4, delay } },
    exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
  };
}

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <motion.div {...fade()} className="text-center">
      <div className="h-20 w-20 mx-auto rounded-2xl overflow-hidden border border-primary/20 mb-8">
        <img src={duncanAvatar} alt="Duncan" className="h-full w-full object-cover object-[50%_30%] scale-150" />
      </div>
      <h1 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight mb-3">
        Welcome to Duncan
      </h1>
      <p className="text-base text-muted-foreground max-w-md mx-auto mb-10 leading-relaxed">
        Your operational intelligence layer. Let's get you set up — it takes about a minute.
      </p>

      <div className="text-left space-y-3 mb-10 max-w-sm mx-auto">
        <Row n="1" title="Connect your tools" desc="Gmail and Calendar so Duncan can act on your behalf." />
        <Row n="2" title="Personalise Duncan" desc="Tell Duncan how you work and what matters." />
        <Row n="3" title="You're in" desc="Full workspace access unlocked." />
      </div>

      <button
        onClick={onNext}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Get started <ArrowRight className="h-4 w-4" />
      </button>
    </motion.div>
  );
}

function Row({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="h-6 w-6 shrink-0 rounded-full bg-secondary text-foreground text-xs font-semibold flex items-center justify-center">
        {n}
      </div>
      <div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
    </div>
  );
}

function StepIntegrations({
  onBack, onNext,
}: { onBack: () => void; onNext: () => void }) {
  const gmailStatus = useGmailStatus();
  const { connect: connectGmail, loading: gmailConnecting } = useGmailConnect();
  const { isConnected: calConnected, checkConnection, initiateOAuth, isLoading: calConnecting } = useGoogleCalendar();

  useEffect(() => {
    checkConnection();
    const i = setInterval(() => {
      gmailStatus.refetch();
      checkConnection();
    }, 4000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gmailOk = !!gmailStatus.data?.connected && !gmailStatus.data?.expired;
  const calOk = calConnected === true;
  const bothOk = gmailOk && calOk;

  return (
    <motion.div {...fade()}>
      <h2 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight mb-2">
        Connect your tools
      </h2>
      <p className="text-sm text-muted-foreground mb-8">
        Duncan needs access to your inbox and calendar to work effectively. Both are required.
      </p>

      <div className="space-y-3 mb-8">
        <IntegrationRow
          icon={<Mail className="h-5 w-5" />}
          title="Gmail"
          desc="Read, draft, and reason over your email."
          connected={gmailOk}
          loading={gmailConnecting || gmailStatus.isLoading}
          subtitle={gmailStatus.data?.email}
          onConnect={connectGmail}
        />
        <IntegrationRow
          icon={<Calendar className="h-5 w-5" />}
          title="Google Calendar"
          desc="Schedule, check availability, and surface key events."
          connected={calOk}
          loading={calConnecting || calConnected === null}
          onConnect={initiateOAuth}
        />
      </div>

      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          Back
        </button>
        <div className="flex items-center gap-3">
          {!bothOk && (
            <button
              onClick={onNext}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Skip for now
            </button>
          )}
          <button
            onClick={onNext}
            disabled={!bothOk}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Continue <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function IntegrationRow({
  icon, title, desc, connected, loading, subtitle, onConnect,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  connected: boolean;
  loading?: boolean;
  subtitle?: string;
  onConnect: () => void | Promise<void>;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${connected ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-secondary text-muted-foreground"}`}>
        {connected ? <Check className="h-5 w-5" /> : icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground truncate">
          {connected ? (subtitle || "Connected") : desc}
        </div>
      </div>
      {connected ? (
        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Connected</span>
      ) : (
        <button
          onClick={() => onConnect()}
          disabled={loading}
          className="rounded-lg border border-border bg-background px-3.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary disabled:opacity-50 transition-colors flex items-center gap-1.5"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Connect
        </button>
      )}
    </div>
  );
}

function StepPersonalization({
  onBack, onNext, completing,
}: { onBack: () => void; onNext: () => void; completing: boolean }) {
  const [saved, setSaved] = useState(false);

  return (
    <motion.div {...fade()}>
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <h2 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
          Personalise Duncan
        </h2>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        These preferences power Duncan's responses. You can update them anytime in Settings.
      </p>

      <div className="rounded-xl border border-border bg-card p-5 mb-6">
        <PersonalizationForm
          hideHeader
          primarySave
          saveLabel={saved ? "Saved — update" : "Save preferences"}
          onSaved={() => setSaved(true)}
        />
      </div>

      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!saved || completing}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {completing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Activate Duncan
        </button>
      </div>
    </motion.div>
  );
}
