import { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar, { MobileMenuButton } from "@/components/Sidebar";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { CommandPalette, useCommandPaletteShortcut } from "@/components/command/CommandPalette";
import { ContextRail } from "@/components/context/ContextRail";
import { Search } from "lucide-react";

const AppLayout = ({ children }: { children?: React.ReactNode }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useCommandPaletteShortcut(setPaletteOpen);

  return (
    <div
      className="flex min-h-[100dvh] bg-background"
      style={{
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <Sidebar mobileOpen={mobileMenuOpen} onMobileClose={() => setMobileMenuOpen(false)} />
      <div className="md:ml-64 flex-1 flex flex-col min-h-[100dvh] w-full min-w-0">
        {/* Mobile header with menu button */}
        <div
          className="md:hidden flex items-center justify-between gap-2 border-b border-border px-4 py-3"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <div className="flex items-center gap-2">
            <MobileMenuButton onClick={() => setMobileMenuOpen(true)} />
            <span className="text-sm font-bold text-foreground">Duncan</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
              aria-label="Search"
            >
              <Search className="h-4 w-4" />
            </button>
            <NotificationsBell />
          </div>
        </div>
        {/* Desktop floating controls */}
        <div className="hidden md:flex fixed top-3 right-4 z-40 items-center gap-2">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 rounded-md border border-border bg-background/80 backdrop-blur px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            aria-label="Open command palette"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search…</span>
            <kbd className="hidden xl:inline-flex h-5 items-center gap-0.5 rounded border border-border bg-muted px-1.5 text-[10px] font-mono text-muted-foreground">
              ⌘K
            </kbd>
          </button>
          <NotificationsBell />
        </div>
        <div
          className="flex-1 flex flex-col overflow-hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {children ?? <Outlet />}
        </div>
      </div>

      {/* Right-side Context Rail (desktop only) */}
      <ContextRail />

      {/* Global Command Palette */}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
};

export default AppLayout;
