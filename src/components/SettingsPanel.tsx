import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Settings, User, Bug, Palette, Plug, Sparkles } from "lucide-react";
import SettingsGeneral from "./settings/SettingsGeneral";
import SettingsProfile from "./settings/SettingsProfile";
import SettingsBugReport from "./settings/SettingsBugReport";
import SettingsAppearance from "./settings/SettingsAppearance";
import SettingsFeatureRequest from "./settings/SettingsFeatureRequest";
import SettingsIntegrations from "./settings/SettingsIntegrations";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { cn } from "@/lib/utils";

const baseSections = [
  { id: "general", label: "General", icon: Settings },
  { id: "profile", label: "Profile", icon: User },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "request_feature", label: "Request Feature", icon: Sparkles },
  { id: "bug", label: "Bug Report", icon: Bug },
] as const;

const adminFeatureSection = { id: "feature_requests", label: "Feature Requests", icon: Lightbulb } as const;

type SectionId = "general" | "profile" | "appearance" | "integrations" | "request_feature" | "bug" | "feature_requests";


interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [active, setActive] = useState<SectionId>("profile");
  const { isAdmin } = useIsAdmin();
  const sections = isAdmin ? [...baseSections, adminFeatureSection] : baseSections;

  useEffect(() => {
    if (open) {
      setActive("profile");
    }
  }, [open]);

  if (!open) return null;

  const renderContent = () => {
    switch (active) {
      case "general":
        return <SettingsGeneral />;
      case "profile":
        return <SettingsProfile />;
      case "appearance":
        return <SettingsAppearance />;
      case "integrations":
        return <SettingsIntegrations onNavigate={onClose} />;
      case "request_feature":
        return <SettingsFeatureRequest />;
      case "bug":
        return <SettingsBugReport />;
      case "feature_requests":
        return <FeatureRequestsAdmin />;

    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[70] flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-background/80 backdrop-blur-sm"
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="relative z-10 w-full max-w-3xl mx-4 h-[min(90vh,640px)] rounded-2xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
            <h2 className="text-base font-semibold text-foreground">Settings</h2>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row flex-1 min-h-0">
            <nav className="hidden sm:flex w-48 shrink-0 flex-col border-r border-border py-3 px-2 overflow-y-auto">
              {sections.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.id}
                    onClick={() => setActive(s.id)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 w-full text-left",
                      active === s.id
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{s.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="sm:hidden flex border-b border-border overflow-x-auto shrink-0 px-2 gap-1 py-2">
              {sections.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.id}
                    onClick={() => setActive(s.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors shrink-0",
                      active === s.id
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-secondary/60"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {s.label}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={active}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.15 }}
                >
                  {renderContent()}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
