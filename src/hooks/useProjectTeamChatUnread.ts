import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Lightweight unread counter for a project's team chat.
 * Runs even when the chat drawer is closed so the header badge can update live.
 */
export function useProjectTeamChatUnread(projectId: string | null) {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!projectId || !user) {
      setCount(0);
      return;
    }
    let cancelled = false;
    let lastRead = 0;

    const load = async () => {
      const [{ data: readRow }, { count: total }] = await Promise.all([
        supabase
          .from("project_message_reads")
          .select("last_read_at")
          .eq("project_id", projectId)
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("project_messages")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId)
          .is("deleted_at", null)
          .neq("user_id", user.id),
      ]);
      if (cancelled) return;
      lastRead = readRow?.last_read_at ? new Date(readRow.last_read_at).getTime() : 0;
      if (!lastRead) {
        setCount(total || 0);
        return;
      }
      // Refine with a filtered count above lastRead
      const { count: unread } = await supabase
        .from("project_messages")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .neq("user_id", user.id)
        .gt("created_at", new Date(lastRead).toISOString());
      if (!cancelled) setCount(unread || 0);
    };

    load();

    const channel = supabase
      .channel(`project-chat-unread:${projectId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "project_messages", filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = payload.new as { user_id: string; created_at: string };
          if (row.user_id === user.id) return;
          if (!lastRead || new Date(row.created_at).getTime() > lastRead) {
            setCount((c) => c + 1);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_message_reads",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const row = (payload.new || payload.old) as { user_id: string; last_read_at?: string };
          if (row.user_id !== user.id) return;
          if (payload.eventType === "DELETE") {
            lastRead = 0;
          } else if (row.last_read_at) {
            lastRead = new Date(row.last_read_at).getTime();
            setCount(0);
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [projectId, user]);

  return count;
}
