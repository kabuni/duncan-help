import { createContext, useContext, ReactNode } from "react";
import { useNormanChat } from "@/hooks/useNormanChat";

type NormanChatValue = ReturnType<typeof useNormanChat>;

const NormanChatContext = createContext<NormanChatValue | null>(null);

export const NormanChatProvider = ({ children }: { children: ReactNode }) => {
  // Mounted once at the app-shell level so in-flight chat requests, streamed
  // messages, and pending writes survive route navigation (e.g. user leaves
  // Home while Duncan is still generating a reply and comes back later).
  const value = useNormanChat();
  return (
    <NormanChatContext.Provider value={value}>
      {children}
    </NormanChatContext.Provider>
  );
};

export function useNormanChatContext(): NormanChatValue {
  const ctx = useContext(NormanChatContext);
  if (!ctx) {
    throw new Error("useNormanChatContext must be used within NormanChatProvider");
  }
  return ctx;
}
