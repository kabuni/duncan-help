import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getAuthUser } from "@/lib/authStorage";

export interface NotificationRow {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  metadata: Record<string, any>;
  read_at: string | null;
  created_at: string;
}

export function useNotifications() {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const uid = getAuthUser()?.id || null;
    setUserId(uid);
    if (!uid) {
      setItems([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("notifications" as any)
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(30);
    setItems((data as any[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime subscription
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const unreadCount = items.filter((n) => !n.read_at).length;

  const markRead = useCallback(async (id: string) => {
    await supabase
      .from("notifications" as any)
      .update({ read_at: new Date().toISOString() })
      .eq("id", id);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
  }, []);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    const now = new Date().toISOString();
    await supabase
      .from("notifications" as any)
      .update({ read_at: now })
      .eq("user_id", userId)
      .is("read_at", null);
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
  }, [userId]);

  return { items, loading, unreadCount, markRead, markAllRead, reload: load };
}
