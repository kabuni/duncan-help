import { useState, useEffect } from "react";
import { LayoutDashboard, Home, Plug, Settings, LogOut, X, ChevronDown, CheckCircle2, MessageSquare, Calendar, FolderOpen, GitBranch, Zap, Menu, Layers, Crown, Inbox, Receipt, BookOpen, MoreHorizontal, Mail, Users, MessageCircle } from "lucide-react";
import { canViewBriefing } from "@/lib/ceoAccess";
import ChatHistory from "@/components/ChatHistory";
import { useGeneralChatsContext } from "@/hooks/GeneralChatsContext";
import type { useGeneralChats } from "@/hooks/useGeneralChats";
import duncanAvatar from "@/assets/duncan-avatar.jpeg";
import SettingsPanel from "@/components/SettingsPanel";
import ThemeToggle from "@/components/ThemeToggle";
import { NavLink as RouterNavLink, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useApprovalCount } from "@/hooks/useApprovals";

const integrationMeta: Record<string, { label: string; icon: React.ElementType }> = {
  "slack": { label: "Slack", icon: MessageSquare },
  "linear": { label: "Linear", icon: Zap },
  "google-calendar": { label: "Google Calendar", icon: Calendar },
  "azure-blob": { label: "Azure Blob", icon: FolderOpen },
  "azure-devops": { label: "Azure DevOps", icon: GitBranch },
};

export const MobileMenuButton = ({ onClick }: { onClick: () => void }) => (
  <button
    onClick={onClick}
    className="md:hidden flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
    aria-label="Open menu"
  >
    <Menu className="h-5 w-5" />
  </button>
);

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150",
    isActive
      ? "bg-primary/10 text-primary glow-primary-sm"
      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
  );

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="px-3 pt-4 pb-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">
    {children}
  </p>
);

const Sidebar = ({
  mobileOpen,
  onMobileClose,
  onSelectChat,
  onNewChat,
}: {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  onSelectChat?: (chatId: string) => void;
  onNewChat?: () => void;
  chatOps?: ReturnType<typeof useGeneralChats>;
}) => {
  const chatOps = useGeneralChatsContext();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [connectedApps, setConnectedApps] = useState<string[]>([]);
  const { data: pendingApprovals = 0 } = useApprovalCount();

  useEffect(() => {
    const fetchConnected = async () => {
      try {
        const { data: companyAll } = await supabase.rpc("get_company_integrations_status");
        const company = (companyAll ?? []).filter((c: any) => c.status === "connected");

        const { data: userInt } = await supabase
          .from("user_integrations")
          .select("integration_id")
          .eq("status", "connected");

        const ids = new Set<string>();
        company?.forEach((c) => ids.add(c.integration_id));
        userInt?.forEach((u) => ids.add(u.integration_id));

        const [{ data: gcal }, { data: gmail }, { data: azureDevops }] = await Promise.all([
          supabase.from("google_calendar_tokens").select("id").limit(1),
          supabase.from("gmail_tokens").select("id").limit(1),
          supabase.from("azure_devops_tokens").select("id").limit(1),
        ]);

        if (gcal?.length) ids.add("google-calendar");
        if (gmail?.length) ids.add("gmail");
        if (azureDevops?.length) ids.add("azure-devops");

        setConnectedApps(Array.from(ids));
      } catch {
        // silent
      }
    };
    if (user) fetchConnected();
  }, [user]);

  const handleNavigate = (to: string) => {
    navigate(to);
    onMobileClose?.();
  };

  const sidebarContent = (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-sidebar">
      {/* Brand */}
      <div className="flex items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-lg overflow-hidden glow-primary-sm">
            <img src={duncanAvatar} alt="Duncan" className="h-full w-full object-cover object-[50%_30%] scale-150" />
            <div className="absolute inset-0 rounded-lg border border-primary/20" />
          </div>
          <div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <h1 className="text-lg font-bold tracking-tight text-foreground cursor-default">Duncan</h1>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[200px]">
                  <p className="text-xs">A tribute to Nimesh's dog Duncan — the inspiration behind the system.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <p className="text-[10px] font-mono tracking-widest text-muted-foreground">KabuniOS</p>
          </div>
        </div>
        <button
          onClick={onMobileClose}
          className="md:hidden flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 min-h-0 overflow-y-auto px-3 pb-4">
        <RouterNavLink
          to="/"
          end
          onClick={() => {
            onMobileClose?.();
            window.dispatchEvent(
              new CustomEvent("duncan:show-dashboard", { detail: { explicit: true } })
            );
          }}
          className={navItemClass}
        >
          <Home className="h-4 w-4" />
          Dashboard
        </RouterNavLink>

        {/* WORK */}
        <SectionLabel>Work</SectionLabel>
        <div className="space-y-0.5">
          <RouterNavLink to="/projects" onClick={() => onMobileClose?.()} className={navItemClass}>
            <Layers className="h-4 w-4" />
            Projects
          </RouterNavLink>
          <RouterNavLink to="/workstreams" onClick={() => onMobileClose?.()} className={navItemClass}>
            <LayoutDashboard className="h-4 w-4" />
            Workstreams
          </RouterNavLink>
          <RouterNavLink to="/diary" onClick={() => onMobileClose?.()} className={navItemClass}>
            <Calendar className="h-4 w-4" />
            Planner
          </RouterNavLink>
        </div>

        {/* INTELLIGENCE */}
        <SectionLabel>Intelligence</SectionLabel>
        <div className="space-y-0.5">
          <RouterNavLink to="/operations" onClick={() => onMobileClose?.()} className={navItemClass}>
            <GitBranch className="h-4 w-4" />
            Operations
          </RouterNavLink>
          <RouterNavLink to="/knowledge-base" onClick={() => onMobileClose?.()} className={navItemClass}>
            <BookOpen className="h-4 w-4" />
            Knowledge Base
          </RouterNavLink>
          {canViewBriefing(user?.email) && (
            <RouterNavLink to="/team-briefing" onClick={() => onMobileClose?.()} className={navItemClass}>
              <Crown className="h-4 w-4" />
              Team Briefing
            </RouterNavLink>
          )}
        </div>

        {/* ADMIN */}
        <SectionLabel>Admin</SectionLabel>
        <div className="space-y-0.5">
          <RouterNavLink to="/approvals" onClick={() => onMobileClose?.()} className={navItemClass}>
            <Inbox className="h-4 w-4" />
            <span className="flex-1">Approvals</span>
            {pendingApprovals > 0 && (
              <span className="ml-auto rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-semibold px-1.5 py-0.5 min-w-[18px] text-center">
                {pendingApprovals}
              </span>
            )}
          </RouterNavLink>
          <RouterNavLink to="/purchase-orders" onClick={() => onMobileClose?.()} className={navItemClass}>
            <Receipt className="h-4 w-4" />
            Authorisation Requests
          </RouterNavLink>
          <div>
            <button
              onClick={() => setIntegrationsOpen(!integrationsOpen)}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all duration-150"
            >
              <Plug className="h-4 w-4" />
              <span className="flex-1 text-left">Integrations</span>
              <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform duration-200", integrationsOpen && "rotate-180")} />
            </button>
            {integrationsOpen && (
              <div className="ml-4 mt-1 space-y-0.5 border-l border-border pl-3">
                {connectedApps.length === 0 ? (
                  <p className="px-3 py-2 text-[11px] text-muted-foreground">No apps connected</p>
                ) : (
                  connectedApps.map((id) => {
                    const meta = integrationMeta[id];
                    if (!meta) return null;
                    const Icon = meta.icon;
                    return (
                      <button
                        key={id}
                        onClick={() => handleNavigate("/integrations")}
                        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                      >
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="flex-1 text-left truncate">{meta.label}</span>
                        <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                      </button>
                    );
                  })
                )}
                <button
                  onClick={() => handleNavigate("/integrations")}
                  className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[11px] font-medium text-primary hover:bg-primary/5 transition-colors"
                >
                  Manage all →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Chat History */}
        <div className="mt-4">
          <ChatHistory
            chats={chatOps.chats}
            activeChatId={chatOps.activeChatId}
            onSelectChat={(id) => {
              chatOps.setActiveChatId(id);
              onSelectChat?.(id);
              navigate("/");
              onMobileClose?.();
            }}
            onNewChat={() => {
              chatOps.startNewChat();
              onNewChat?.();
              navigate("/", { state: { newChat: true } });
              onMobileClose?.();
            }}
            onDeleteChat={chatOps.deleteChat}
            onRenameChat={chatOps.updateTitle}
            onMobileClose={onMobileClose}
          />
        </div>

        {/* MORE (collapsed) */}
        <div className="mt-4">
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all duration-150"
          >
            <MoreHorizontal className="h-4 w-4" />
            <span className="flex-1 text-left">More</span>
            <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform duration-200", moreOpen && "rotate-180")} />
          </button>
          {moreOpen && (
            <div className="ml-4 mt-1 space-y-0.5 border-l border-border pl-3">
              <RouterNavLink to="/gmail" onClick={() => onMobileClose?.()} className={navItemClass}>
                <Mail className="h-4 w-4" />
                Gmail
              </RouterNavLink>
              <RouterNavLink to="/recruitment" onClick={() => onMobileClose?.()} className={navItemClass}>
                <Users className="h-4 w-4" />
                Recruitment
              </RouterNavLink>
              <RouterNavLink to="/feedback" onClick={() => onMobileClose?.()} className={navItemClass}>
                <MessageCircle className="h-4 w-4" />
                Feedback
              </RouterNavLink>
            </div>
          )}
        </div>
      </nav>

      {/* User */}
      <div className="border-t border-border px-4 py-4 space-y-2">
        {user && (
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{user.email}</p>
            </div>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <button onClick={() => { signOut(); onMobileClose?.(); }} className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors" title="Sign out">
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-all duration-150 w-full"
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </button>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden md:block fixed left-0 top-0 z-40 h-screen">
        {sidebarContent}
      </div>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onMobileClose} />
          <div className="relative z-10 h-full w-64 shadow-2xl animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </div>
        </div>
      )}

      <SettingsPanel open={showModal} onClose={() => setShowModal(false)} />
    </>
  );
};

export default Sidebar;
