import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export interface TeamChatAttachment {
  path: string;
  name: string;
  type: string;
  size: number;
}

export interface TeamChatMessage {
  id: string;
  project_id: string;
  user_id: string;
  content: string;
  attachments: TeamChatAttachment[];
  reply_to_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  pinned_at: string | null;
  pinned_by: string | null;
  created_at: string;
  author_name?: string | null;
  author_avatar_url?: string | null;
}

interface ReadRow {
  project_id: string;
  user_id: string;
  last_read_at: string;
}

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
}

export function useProjectTeamChat(projectId: string | null, memberIds: string[]) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<TeamChatMessage[]>([]);
  const [reads, setReads] = useState<ReadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Record<string, { name: string; at: number }>>({});
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const authorCacheRef = useRef<Map<string, { name: string | null; avatar_url: string | null }>>(new Map());

  const hydrateAuthors = useCallback(async (rows: TeamChatMessage[]) => {
    const missing = Array.from(new Set(rows.map((r) => r.user_id).filter((id) => !authorCacheRef.current.has(id))));
    if (missing.length > 0) {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, display_name, avatar_url")
        .in("user_id", missing);
      for (const p of (data as any[]) || []) {
        authorCacheRef.current.set(p.user_id, { name: p.display_name, avatar_url: p.avatar_url });
      }
    }
    return rows.map((r) => {
      const p = authorCacheRef.current.get(r.user_id);
      return { ...r, author_name: p?.name ?? null, author_avatar_url: p?.avatar_url ?? null };
    });
  }, []);

  // Initial load
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [{ data: msgs }, { data: readRows }] = await Promise.all([
        supabase
          .from("project_messages")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at", { ascending: true })
          .limit(500),
        supabase.from("project_message_reads").select("*").eq("project_id", projectId),
      ]);
      if (cancelled) return;
      const hydrated = await hydrateAuthors(((msgs as any[]) || []) as TeamChatMessage[]);
      if (cancelled) return;
      setMessages(hydrated);
      setReads((readRows as ReadRow[]) || []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, hydrateAuthors]);

  // Realtime for messages + reads
  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`project-chat:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_messages", filter: `project_id=eq.${projectId}` },
        async (payload) => {
          if (payload.eventType === "INSERT") {
            const [hydrated] = await hydrateAuthors([payload.new as TeamChatMessage]);
            setMessages((prev) => (prev.some((m) => m.id === hydrated.id) ? prev : [...prev, hydrated]));
          } else if (payload.eventType === "UPDATE") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === (payload.new as any).id
                  ? { ...m, ...(payload.new as any), author_name: m.author_name, author_avatar_url: m.author_avatar_url }
                  : m,
              ),
            );
          } else if (payload.eventType === "DELETE") {
            setMessages((prev) => prev.filter((m) => m.id !== (payload.old as any).id));
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_message_reads", filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = (payload.new || payload.old) as ReadRow;
          if (!row) return;
          setReads((prev) => {
            const next = prev.filter((r) => r.user_id !== row.user_id);
            if (payload.eventType !== "DELETE") next.push(payload.new as ReadRow);
            return next;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, hydrateAuthors]);

  // Typing indicator channel (broadcast, ephemeral)
  useEffect(() => {
    if (!projectId || !user) return;
    const channel = supabase.channel(`project-chat-typing:${projectId}`, {
      config: { broadcast: { self: false } },
    });
    channel.on("broadcast", { event: "typing" }, ({ payload }: any) => {
      if (!payload?.user_id || payload.user_id === user.id) return;
      setTypingUsers((prev) => ({
        ...prev,
        [payload.user_id]: { name: payload.name || "Someone", at: Date.now() },
      }));
    });
    channel.subscribe();
    typingChannelRef.current = channel;
    const cleanup = setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now();
        const next: typeof prev = {};
        for (const [k, v] of Object.entries(prev)) if (now - v.at < 4000) next[k] = v;
        return next;
      });
    }, 1500);
    return () => {
      clearInterval(cleanup);
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
    };
  }, [projectId, user]);

  const broadcastTyping = useCallback(
    (name: string) => {
      const ch = typingChannelRef.current;
      if (!ch || !user) return;
      ch.send({ type: "broadcast", event: "typing", payload: { user_id: user.id, name } });
    },
    [user],
  );

  const markAllRead = useCallback(async () => {
    if (!projectId || !user) return;
    const now = new Date().toISOString();
    await supabase
      .from("project_message_reads")
      .upsert({ project_id: projectId, user_id: user.id, last_read_at: now }, { onConflict: "project_id,user_id" });
  }, [projectId, user]);

  const sendMessage = useCallback(
    async (content: string, files: File[], replyToId?: string | null) => {
      if (!projectId || !user) return;
      const trimmed = content.trim();
      if (!trimmed && files.length === 0) return;
      setSending(true);
      try {
        const uploaded: TeamChatAttachment[] = [];
        for (const f of files) {
          if (f.size > MAX_FILE_SIZE) {
            toast.error(`${f.name} exceeds 25MB`);
            continue;
          }
          const path = `${projectId}/${user.id}/${Date.now()}-${safeName(f.name)}`;
          const { error: upErr } = await supabase.storage
            .from("project-chat-attachments")
            .upload(path, f, { contentType: f.type || "application/octet-stream", upsert: false });
          if (upErr) {
            toast.error(`Upload failed: ${f.name}`);
            continue;
          }
          uploaded.push({ path, name: f.name, type: f.type || "application/octet-stream", size: f.size });
        }
        const { error } = await supabase.from("project_messages").insert({
          project_id: projectId,
          user_id: user.id,
          content: trimmed,
          attachments: uploaded as any,
          reply_to_id: replyToId ?? null,
        });
        if (error) throw error;
        await markAllRead();
      } catch (e: any) {
        toast.error(e?.message || "Failed to send");
      } finally {
        setSending(false);
      }
    },
    [projectId, user, markAllRead],
  );

  const editMessage = useCallback(
    async (id: string, content: string) => {
      const { error } = await supabase
        .from("project_messages")
        .update({ content })
        .eq("id", id);
      if (error) toast.error(error.message);
    },
    [],
  );

  const deleteMessage = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("project_messages")
        .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id, content: "", attachments: [] as any })
        .eq("id", id);
      if (error) toast.error(error.message);
    },
    [user],
  );

  const togglePin = useCallback(async (msg: TeamChatMessage) => {
    const isPinned = !!msg.pinned_at;
    const { error } = await supabase
      .from("project_messages")
      .update(
        isPinned
          ? { pinned_at: null, pinned_by: null }
          : { pinned_at: new Date().toISOString(), pinned_by: user?.id },
      )
      .eq("id", msg.id);
    if (error) toast.error(error.message);
  }, [user]);

  const attachmentUrl = useCallback(async (path: string) => {
    const { data } = await supabase.storage.from("project-chat-attachments").createSignedUrl(path, 60 * 60);
    return data?.signedUrl || null;
  }, []);

  // Derived: unread count for current user
  const myLastRead = useMemo(() => {
    if (!user) return null;
    return reads.find((r) => r.user_id === user.id)?.last_read_at ?? null;
  }, [reads, user]);

  const unreadCount = useMemo(() => {
    if (!user) return 0;
    const cutoff = myLastRead ? new Date(myLastRead).getTime() : 0;
    return messages.filter((m) => m.user_id !== user.id && !m.deleted_at && new Date(m.created_at).getTime() > cutoff)
      .length;
  }, [messages, myLastRead, user]);

  // "Seen by all": min(last_read_at across other members) >= message.created_at
  const seenByAllCutoff = useMemo(() => {
    if (!user || memberIds.length <= 1) return null;
    const others = memberIds.filter((id) => id !== user.id);
    if (others.length === 0) return null;
    const times: number[] = [];
    for (const id of others) {
      const r = reads.find((x) => x.user_id === id);
      if (!r) return null; // if any hasn't read anything, nothing is seen by all
      times.push(new Date(r.last_read_at).getTime());
    }
    return Math.min(...times);
  }, [reads, memberIds, user]);

  return {
    messages,
    loading,
    sending,
    unreadCount,
    seenByAllCutoff,
    typingUsers,
    sendMessage,
    editMessage,
    deleteMessage,
    togglePin,
    markAllRead,
    broadcastTyping,
    attachmentUrl,
  };
}
