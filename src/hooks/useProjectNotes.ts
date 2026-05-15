import { useEffect, useState, useCallback } from "react";
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

export function useProjectNotes(projectId: string | null) {
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [loading, setLoading] = useState(false);

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
        () => fetchNotes(),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId, fetchNotes]);

  const createNote = async (title = "Untitled note", content = "") => {
    if (!projectId) return null;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Not signed in"); return null; }
    const { data, error } = await supabase
      .from("project_notes" as any)
      .insert({ project_id: projectId, created_by: user.id, title, content })
      .select()
      .single();
    if (error) { toast.error(error.message); return null; }
    return data as any as ProjectNote;
  };

  const updateNote = async (id: string, patch: Partial<Pick<ProjectNote, "title" | "content" | "pinned">>) => {
    const { error } = await supabase.from("project_notes" as any).update(patch).eq("id", id);
    if (error) toast.error(error.message);
  };

  const deleteNote = async (id: string) => {
    const { error } = await supabase.from("project_notes" as any).delete().eq("id", id);
    if (error) toast.error(error.message);
  };

  return { notes, loading, createNote, updateNote, deleteNote, refetch: fetchNotes };
}
