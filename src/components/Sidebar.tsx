import { useState } from "react";
import { LayoutDashboard, Home, Settings, LogOut, X, Mail, FileText, MessageSquare, Calendar, GitBranch, Menu, Layers, Megaphone, Crown, Inbox, Receipt, Users, School } from "lucide-react";
import { canViewBriefing } from "@/lib/ceoAccess";
import ChatHistory from "@/components/ChatHistory";
import { useGeneralChatsContext } from "@/hooks/GeneralChatsContext";
import type { useGeneralChats } from "@/hooks/useGeneralChats";
import duncanAvatar from "@/assets/duncan-avatar.jpeg";
import SettingsPanel from "@/components/SettingsPanel";
import ThemeToggle from "@/components/ThemeToggle";
import { NavLink as RouterNavLink, useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useApprovalCount } from "@/hooks/useApprovals";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useProfile } from "@/hooks/useProfile";



export const MobileMenuButton = ({ onClick }: { onClick: () => void }) => (
  <button
    onClick={onClick}
    className="md:hidden flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
    aria-label="Open menu"
  >
    <Menu className="h-5 w-5" />
  </button>
);

const Sidebar = ({
  mobileOpen,
  onMobileClose,
  onSelectChat,
  onNewChat,
  chatOps: externalChatOps,
}: {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  onSelectChat?: (chatId: string) => void;
  onNewChat?: () => void;
  chatOps?: ReturnType<typeof useGeneralChats>;
}) => {
  const chatOps = useGeneralChatsContext();
  const { user, signOut } = useAuth();
  const { profile } = useProfile();
  const navigate = useNavigate();
  const location = useLocation();
  const isProjectsRoute = location.pathname.startsWith("/projects");
  const isChatRoute = !isProjectsRoute;
  const [showModal, setShowModal] = useState(false);
  const { data: pendingApprovals = 0 } = useApprovalCount();
  const { isAdmin } = useIsAdmin();


  const handleNavigate = (to: string) => {
    navigate(to);
    onMobileClose?.();
  };

  const sidebarContent = (
    <aside className={cn(
      "flex h-full w-64 flex-col border-r border-border bg-sidebar",
    )}>
      {/* Brand */}
      <div className="flex items-center justify-between px-6 py-6">
        <button
          onClick={() => { navigate("/"); onMobileClose?.(); }}
          className="flex items-center gap-3 text-left rounded-md hover:opacity-90 transition-opacity"
          aria-label="Go to Home"
        >
          <div className="relative flex h-9 w-9 items-center justify-center rounded-lg overflow-hidden glow-primary-sm">
            <img src={duncanAvatar} alt="Duncan" className="h-full w-full object-cover object-[50%_30%] scale-150" />
            <div className="absolute inset-0 rounded-lg border border-primary/20" />
          </div>
          <div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <h1 className="text-lg font-bold tracking-tight text-foreground cursor-pointer">Duncan</h1>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[200px]">
                  <p className="text-xs">A tribute to Nimesh's dog Duncan — the inspiration behind the system.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <p className="text-[10px] font-mono tracking-widest text-muted-foreground">KabuniOS</p>
          </div>
        </button>

        {/* Close button on mobile */}
        <button
          onClick={onMobileClose}
          className="md:hidden flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Segmented tabs: Chat / Projects */}
      <div className="px-3 pb-2">
        <div className="flex items-center rounded-lg border border-border bg-card p-1">
          <button
            onClick={() => {
              chatOps.startNewChat();
              onNewChat?.();
              navigate("/", { state: { newChat: true } });
              onMobileClose?.();
            }}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              isChatRoute
                ? "bg-primary/10 text-primary glow-primary-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
            )}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Chat
          </button>
          <button
            onClick={() => {
              navigate("/projects");
              onMobileClose?.();
            }}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              isProjectsRoute
                ? "bg-primary/10 text-primary glow-primary-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
            )}
          >
            <Layers className="h-3.5 w-3.5" />
            Projects
          </button>
        </div>
      </div>

      {/* Nav */}

      <nav className="flex-1 min-h-0 overflow-y-auto space-y-1 px-3 py-4">
        <RouterNavLink
          to="/"
          end
          onClick={() => {
            onMobileClose?.();
            window.dispatchEvent(
              new CustomEvent("duncan:show-dashboard", {
                detail: { explicit: true },
              })
            );
          }}
          className={({ isActive }) =>
            cn("flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-150",
              isActive ? "bg-primary/10 text-primary glow-primary-sm" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )
          }
        >
          <Home className="h-4 w-4" />
          Home
        </RouterNavLink>


        <RouterNavLink
          to="/workstreams"
          onClick={() => onMobileClose?.()}
          className={({ isActive }) =>
            cn("flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-150",
              isActive ? "bg-primary/10 text-primary glow-primary-sm" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )
          }
        >
          <LayoutDashboard className="h-4 w-4" />
          Workstreams
        </RouterNavLink>
        <RouterNavLink
          to="/diary"
          onClick={() => onMobileClose?.()}
          className={({ isActive }) =>
            cn("flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-150",
              isActive ? "bg-primary/10 text-primary glow-primary-sm" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )
          }
        >
          <Calendar className="h-4 w-4" />
          Planner
        </RouterNavLink>



        <RouterNavLink
          to="/recruitment"
          onClick={() => onMobileClose?.()}
          className={({ isActive }) =>
            cn("flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-150",
              isActive ? "bg-primary/10 text-primary glow-primary-sm" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )
          }
        >
          <Users className="h-4 w-4" />
          Recruitment
        </RouterNavLink>

        <RouterNavLink
          to="/operations"
          onClick={() => onMobileClose?.()}
          className={({ isActive }) =>
            cn("flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-150",
              isActive ? "bg-primary/10 text-primary glow-primary-sm" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )
          }
        >
          <GitBranch className="h-4 w-4" />
          <span className="flex-1">Operations</span>
          {pendingApprovals > 0 && (
            <span className="ml-auto rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-semibold px-1.5 py-0.5 min-w-[18px] text-center">
              {pendingApprovals}
            </span>
          )}
        </RouterNavLink>

        {isAdmin && (
          <RouterNavLink
            to="/registrations"
            onClick={() => onMobileClose?.()}
            className={({ isActive }) =>
              cn("flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-150",
                isActive ? "bg-primary/10 text-primary glow-primary-sm" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )
            }
          >
            <School className="h-4 w-4" />
            Registrations
          </RouterNavLink>
        )}

        {isAdmin && (
          <RouterNavLink
            to="/ea-inbox"
            onClick={() => onMobileClose?.()}
            className={({ isActive }) =>
              cn("flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-150",
                isActive ? "bg-primary/10 text-primary glow-primary-sm" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )
            }
          >
            <Inbox className="h-4 w-4" />
            EA Inbox
          </RouterNavLink>
        )}

        {canViewBriefing(user?.email) && (
          <RouterNavLink
            to="/team-briefing"
            onClick={() => onMobileClose?.()}
            className={({ isActive }) =>
              cn("flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-150",
                isActive ? "bg-primary/10 text-primary glow-primary-sm" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )
            }
          >
            <Crown className="h-4 w-4" />
            Team Briefing
          </RouterNavLink>
        )}



        {/* Chat History */}
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
      </nav>

      {/* User */}
      <div className="border-t border-border px-3 py-2 space-y-1">
        {user && (
          <div className="flex items-center gap-2">
            <Avatar className="h-7 w-7 shrink-0">
              <AvatarImage src={profile?.avatar_url || user?.user_metadata?.avatar_url || ""} alt="Profile" />
              <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                {(profile?.display_name || user?.email || "?").charAt(0).toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <button
              onClick={() => { signOut(); onMobileClose?.(); }}
              className="group flex-1 min-w-0 text-left rounded-md px-1.5 py-1 hover:bg-sidebar-accent transition-colors"
              title="Sign out"
            >
              <span className="block truncate text-xs font-medium text-foreground group-hover:hidden">
                {user.email}
              </span>
              <span className="hidden group-hover:flex items-center gap-1.5 text-xs font-medium text-foreground">
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </span>
            </button>
            <div className="flex items-center gap-0.5 shrink-0">
              <NotificationsBell />
              <ThemeToggle />
            </div>
          </div>
        )}
        <button
          onClick={() => setShowModal(true)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-0.5 text-[10px] text-muted-foreground/70 hover:text-foreground hover:bg-sidebar-accent transition-colors"
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </button>
        <div className="flex items-center gap-2 px-2 text-[10px] text-muted-foreground/70">
          <a href="https://duncan.help/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Privacy</a>
          <span aria-hidden>·</span>
          <a href="https://duncan.help/terms" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Terms</a>
        </div>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden md:block fixed left-0 top-0 z-40 h-screen">
        {sidebarContent}
      </div>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onMobileClose} />
          <div className="relative z-10 h-full w-64 shadow-2xl animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Settings Panel */}
      <SettingsPanel open={showModal} onClose={() => setShowModal(false)} />
    </>
  );
};

export default Sidebar;
