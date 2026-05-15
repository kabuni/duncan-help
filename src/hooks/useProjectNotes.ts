import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ProjectNote {
  id: string;
  project_id: string;
  created_by: string;
  title: string;
  content: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

// Generate a uuid v4 client-side so optimistic inserts have a stable id
function uuid() {
  // crypto.randomUUID is available in modern browsers
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as any).randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function useProjectNotes(projectId: string | null) {
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [loading, setLoading] = useState(false);
  // Track ids we've mutated locally so realtime echoes don't clobber optimistic state
  const localIdsRef = useRef<Set<string>>(new Set());

  const fetchNotes = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("project_notes" as any)
      .select("*")
      .eq("project_id", projectId)
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false });
    if (error) toast.error(error.message);
    else setNotes((data as any) || []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  useEffect(() => {
    if (!projectId) return;
    const ch = supabase
      .channel(`project_notes:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_notes", filter: `project_id=eq.${projectId}` },
        (payload: any) => {
          const row = (payload.new || payload.old) as ProjectNote | undefined;
          // If this change was just initiated locally, skip — our optimistic state is already correct
          if (row && localIdsRef.current.has(row.id)) {
            localIdsRef.current.delete(row.id);
            return;
          }
          fetchNotes();
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId, fetchNotes]);

  const createNote = async (title = "Untitled note", content = "") => {
    if (!projectId) return null;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Not signed in"); return null; }

    const now = new Date().toISOString();
    const optimistic: ProjectNote = {
      id: uuid(),
      project_id: projectId,
      created_by: user.id,
      title,
      content,
      pinned: false,
      created_at: now,
      updated_at: now,
    };
    localIdsRef.current.add(optimistic.id);
    setNotes((prev) => [optimistic, ...prev]);

    // Fire-and-forget insert — reconcile on error
    supabase
      .from("project_notes" as any)
      .insert(optimistic)
      .then(({ error }) => {
        if (error) {
          toast.error(error.message);
          setNotes((prev) => prev.filter((n) => n.id !== optimistic.id));
          localIdsRef.current.delete(optimistic.id);
        }
      });

    return optimistic;
  };

  const updateNote = async (
    id: string,
    patch: Partial<Pick<ProjectNote, "title" | "content" | "pinned">>,
  ) => {
    // Optimistic update
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...patch, updated_at: new Date().toISOString() } : n)),
    );
    localIdsRef.current.add(id);
    const { error } = await supabase.from("project_notes" as any).update(patch).eq("id", id);
    if (error) {
      toast.error(error.message);
      fetchNotes();
    }
  };

  const deleteNote = async (id: string) => {
    // Optimistic remove
    const prevNotes = notes;
    setNotes((prev) => prev.filter((n) => n.id !== id));
    localIdsRef.current.add(id);
    const { error } = await supabase.from("project_notes" as any).delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      setNotes(prevNotes);
      localIdsRef.current.delete(id);
    }
  };

  return { notes, loading, createNote, updateNote, deleteNote, refetch: fetchNotes };
}
