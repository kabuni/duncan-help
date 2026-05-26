import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getAuthUser } from "@/lib/authStorage";
import { toast } from "sonner";

export interface NoteFolder {
  id: string;
  project_id: string;
  parent_folder_id: string | null;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function useNoteFolders(projectId: string | null) {
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchFolders = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("project_note_folders" as any)
      .select("*")
      .eq("project_id", projectId)
      .order("name", { ascending: true });
    if (error) toast.error(error.message);
    else setFolders((data as any) || []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { fetchFolders(); }, [fetchFolders]);

  const createFolder = async (name: string, parent_folder_id: string | null = null) => {
    if (!projectId) return null;
    const user = getAuthUser();
    if (!user) { toast.error("Not signed in"); return null; }
    const { data, error } = await supabase
      .from("project_note_folders" as any)
      .insert({ project_id: projectId, name: name.trim() || "New folder", parent_folder_id, created_by: user.id })
      .select()
      .single();
    if (error) { toast.error(error.message); return null; }
    setFolders((prev) => [...prev, data as any]);
    return data as any as NoteFolder;
  };

  const renameFolder = async (id: string, name: string) => {
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
    const { error } = await supabase.from("project_note_folders" as any).update({ name }).eq("id", id);
    if (error) { toast.error(error.message); fetchFolders(); }
  };

  const deleteFolder = async (id: string) => {
    const prev = folders;
    setFolders((p) => p.filter((f) => f.id !== id));
    const { error } = await supabase.from("project_note_folders" as any).delete().eq("id", id);
    if (error) { toast.error(error.message); setFolders(prev); }
  };

  return { folders, loading, createFolder, renameFolder, deleteFolder, refetch: fetchFolders };
}
