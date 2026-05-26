import { motion } from "framer-motion";
import { Settings as SettingsIcon, User, UserCheck, Users } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { LogOut } from "lucide-react";
import AccountApprovals from "@/components/settings/AccountApprovals";
import AdminUserManagement from "@/components/settings/AdminUserManagement";

const Settings = () => {
  const { user, signOut } = useAuth();
  const { profile } = useProfile();
  const { isAdmin } = useIsAdmin();

  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto">
        <div className="pointer-events-none fixed top-0 lg:left-64 left-0 right-0 h-72 gradient-radial z-0" />

        <div className="relative z-10 px-4 sm:px-8 py-6 sm:py-8 max-w-3xl">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-8">
            <div className="flex items-center gap-3 mb-1">
              <SettingsIcon className="h-5 w-5 text-primary" />
              <h2 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Settings</h2>
            </div>
            <p className="text-sm text-muted-foreground font-mono">Manage your account and preferences</p>
          </motion.div>

          {/* Admin: Account Approvals */}
          {isAdmin && (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="rounded-xl border border-border bg-card p-4 sm:p-6 mb-6"
            >
              <div className="flex items-center gap-2 mb-4">
                <UserCheck className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Account Approvals</h3>
              </div>
              <AccountApprovals />
            </motion.section>
          )}

          {/* Admin: User Management */}
          {isAdmin && (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.07 }}
              className="rounded-xl border border-border bg-card p-4 sm:p-6 mb-6"
            >
              <div className="flex items-center gap-2 mb-1">
                <Users className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">User Management</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Review registered users and bulk-delete inactive or test accounts.
              </p>
              <AdminUserManagement />
            </motion.section>
          )}

          {/* Account Section */}
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-xl border border-border bg-card p-4 sm:p-6 mb-6"
          >
            <div className="flex items-center gap-2 mb-4">
              <User className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Account</h3>
            </div>
            <div className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground">Email</Label>
                <p className="text-sm text-foreground mt-1">{user?.email ?? "—"}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Display Name</Label>
                <p className="text-sm text-foreground mt-1">{profile?.display_name ?? "—"}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Department</Label>
                <p className="text-sm text-foreground mt-1">{profile?.department ?? "—"}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Role</Label>
                <p className="text-sm text-foreground mt-1">{profile?.role_title ?? "—"}</p>
              </div>
              <Separator className="bg-border" />
              <button
                onClick={signOut}
                className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/20 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          </motion.section>

          <p className="text-[10px] font-mono text-muted-foreground/40 text-center mt-8">
            Duncan · KabuniOS v0.1
          </p>
        </div>
      </main>
    </AppLayout>
  );
};

export default Settings;
