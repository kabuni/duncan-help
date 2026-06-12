import { createContext, useContext, useState, useCallback, ReactNode } from "react";

type SectionId = "general" | "profile" | "appearance" | "integrations" | "request_feature" | "bug";

interface SettingsPanelContextValue {
  open: boolean;
  section: SectionId;
  openSettings: (section?: SectionId) => void;
  closeSettings: () => void;
}

const SettingsPanelContext = createContext<SettingsPanelContextValue | null>(null);

export const SettingsPanelProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SectionId>("profile");

  const openSettings = useCallback((sectionId?: SectionId) => {
    if (sectionId) setSection(sectionId);
    setOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <SettingsPanelContext.Provider value={{ open, section, openSettings, closeSettings }}>
      {children}
    </SettingsPanelContext.Provider>
  );
};

export function useSettingsPanel(): SettingsPanelContextValue {
  const ctx = useContext(SettingsPanelContext);
  if (!ctx) throw new Error("useSettingsPanel must be used within SettingsPanelProvider");
  return ctx;
}

export type { SectionId };
