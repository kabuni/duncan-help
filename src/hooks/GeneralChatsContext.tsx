import { createContext, useContext, ReactNode } from "react";
import { useGeneralChats } from "@/hooks/useGeneralChats";

type GeneralChatsValue = ReturnType<typeof useGeneralChats>;

const GeneralChatsContext = createContext<GeneralChatsValue | null>(null);

export const GeneralChatsProvider = ({ children }: { children: ReactNode }) => {
  const value = useGeneralChats();
  return (
    <GeneralChatsContext.Provider value={value}>
      {children}
    </GeneralChatsContext.Provider>
  );
};

export function useGeneralChatsContext(): GeneralChatsValue {
  const ctx = useContext(GeneralChatsContext);
  if (!ctx) {
    // Fallback for pages rendered outside the provider (e.g. auth pages).
    // Should not happen in normal app flow.
    throw new Error("useGeneralChatsContext must be used within GeneralChatsProvider");
  }
  return ctx;
}
