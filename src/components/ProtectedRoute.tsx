import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Loader2, Clock } from "lucide-react";
import duncanAvatar from "@/assets/duncan-avatar.jpeg";

const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { session, loading, signOut } = useAuth();
  const { profile, isLoading: profileLoading } = useProfile();

  if (loading || (session && profileLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  if (profile && profile.approval_status !== "approved") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center max-w-sm">
          <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-2xl overflow-hidden border border-primary/20 mb-6">
            <img src={duncanAvatar} alt="Duncan" className="h-full w-full object-cover object-[50%_30%] scale-150" />
          </div>
          <div className="flex items-center justify-center gap-2 mb-3">
            <Clock className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-bold text-foreground">Account Pending Approval</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-2">
            Your account has been created successfully. An admin needs to approve your access before you can use Duncan.
          </p>
          <p className="text-xs text-muted-foreground/60 mb-6">
            You'll be able to sign in once your account is approved.
          </p>
          <button
            onClick={signOut}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (profile && profile.approval_status === "approved" && !profile.onboarding_completed_at) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
