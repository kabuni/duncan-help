import { useState } from "react";
import Sidebar, { MobileMenuButton } from "@/components/Sidebar";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div
      className="flex min-h-[100dvh] bg-background"
      style={{
        // iOS notch / Dynamic Island and home-indicator safe areas.
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <Sidebar mobileOpen={mobileMenuOpen} onMobileClose={() => setMobileMenuOpen(false)} />
      <div className="md:ml-64 flex-1 flex flex-col min-h-[100dvh] w-full min-w-0">
        {/* Mobile header with menu button - only shows on pages that don't provide their own */}
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
        {/* Desktop floating bell — sits in the content area top-right, clear of sidebar */}
        <div className="hidden md:flex fixed top-3 right-4 z-40">
          <NotificationsBell />
        </div>
        <div
          className="flex-1 flex flex-col overflow-hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

export default AppLayout;
