import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { PanelLeftOpen } from "lucide-react";
import Sidebar, { MobileMenuButton } from "@/components/Sidebar";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";

import { SettingsPanelProvider } from "@/hooks/SettingsPanelContext";

const SIDEBAR_HIDDEN_KEY = "duncan.sidebar.hidden";

const AppLayout = ({ children }: { children?: React.ReactNode }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopHidden, setDesktopHidden] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_HIDDEN_KEY) === "1";
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_HIDDEN_KEY, desktopHidden ? "1" : "0");
    } catch {
      // ignore storage errors
    }
  }, [desktopHidden]);

  return (
    <SettingsPanelProvider>
      <div
        className="flex min-h-dvh bg-background"
        style={{
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        {!desktopHidden && (
          <Sidebar
            mobileOpen={mobileMenuOpen}
            onMobileClose={() => setMobileMenuOpen(false)}
            onDesktopHide={() => setDesktopHidden(true)}
          />
        )}
        {/* When hidden on mobile, Sidebar is not mounted so the overlay is unavailable;
            keep a lightweight instance for mobile overlay support. */}
        {desktopHidden && (
          <div className="md:hidden">
            <Sidebar
              mobileOpen={mobileMenuOpen}
              onMobileClose={() => setMobileMenuOpen(false)}
            />
          </div>
        )}
        <div
          className={`${desktopHidden ? "" : "md:ml-64"} flex-1 flex flex-col min-h-dvh w-full min-w-0`}
        >
          {/* Floating reopen button (desktop) */}
          {desktopHidden && (
            <button
              onClick={() => setDesktopHidden(false)}
              className="hidden md:flex fixed left-3 top-3 z-40 h-9 w-9 items-center justify-center rounded-lg border border-border bg-background/90 backdrop-blur text-muted-foreground hover:text-foreground hover:bg-secondary/60 shadow-sm transition-colors"
              aria-label="Show sidebar"
              title="Show sidebar"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          )}
          {/* Global search palette (Cmd/Ctrl+K) — mounted once at the shell */}
          <GlobalSearch />
          {/* Mobile header with menu button */}
          <div
            className="md:hidden flex items-center justify-between gap-2 border-b border-border px-4 py-3"
            style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
          >
            <div className="flex items-center gap-2">
              <MobileMenuButton onClick={() => setMobileMenuOpen(true)} />
              <span className="text-sm font-bold text-foreground">Duncan</span>
            </div>
            <NotificationsBell />
          </div>
          <div
            className="flex-1 flex flex-col min-h-0"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            {children ?? <Outlet />}
          </div>
        </div>
      </div>
    </SettingsPanelProvider>
  );
};

export default AppLayout;
