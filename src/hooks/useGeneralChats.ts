import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface GeneralChat {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface GeneralChatMessage {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export function useGeneralChats() {
  const [chats, setChats] = useState<GeneralChat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch all chats
  const fetchChats = useCallback(async () => {
    const { data } = await supabase
      .from("general_chats")
      .select("*")
      .order("updated_at", { ascending: false });
    if (data) setChats(data as GeneralChat[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  // Create a new chat (lazily — only when first message is sent)
  const createChat = useCallback(async (title: string): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from("general_chats")
      .insert({ user_id: user.id, title: title.slice(0, 80) || "New Chat" })
      .select("id")
      .single();

    if (error || !data) return null;
    await fetchChats();
    return (data as any).id;
  }, [fetchChats]);

  // Load messages for a chat
  const loadMessages = useCallback(async (chatId: string): Promise<GeneralChatMessage[]> => {
    const { data } = await supabase
      .from("general_chat_messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true });
    return (data as GeneralChatMessage[]) || [];
  }, []);

  // Save a message
  const saveMessage = useCallback(async (chatId: string, role: "user" | "assistant", content: string) => {
    await supabase.from("general_chat_messages").insert({ chat_id: chatId, role, content });
    // Update the chat's updated_at
    await supabase.from("general_chats").update({ updated_at: new Date().toISOString() }).eq("id", chatId);
  }, []);

  // Update chat title
  const updateTitle = useCallback(async (chatId: string, title: string) => {
    await supabase.from("general_chats").update({ title: title.slice(0, 80) }).eq("id", chatId);
    await fetchChats();
  }, [fetchChats]);

  // Delete a chat
  const deleteChat = useCallback(async (chatId: string) => {
    await supabase.from("general_chats").delete().eq("id", chatId);
    if (activeChatId === chatId) setActiveChatId(null);
    await fetchChats();
  }, [activeChatId, fetchChats]);

  // Start a new chat (clears active — actual DB record created on first message)
  const startNewChat = useCallback(() => {
    setActiveChatId(null);
  }, []);

  return {
    chats,
    activeChatId,
    setActiveChatId,
    loading,
    createChat,
    loadMessages,
    saveMessage,
    updateTitle,
    deleteChat,
    startNewChat,
    fetchChats,
  };
}
