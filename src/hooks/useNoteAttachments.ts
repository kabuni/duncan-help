import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getAuthUser } from "@/lib/authStorage";
import { toast } from "sonner";

export interface NoteAttachment {
  id: string;
  note_id: string;
  project_id: string;
  uploaded_by: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  signed_url?: string;
}

const BUCKET = "project-note-attachments";

export function useNoteAttachments(noteId: string | null, projectId: string | null) {
  const [items, setItems] = useState<NoteAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fetchItems = useCallback(async () => {
    if (!noteId) { setItems([]); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("project_note_attachments" as any)
      .select("*")
      .eq("note_id", noteId)
      .order("created_at", { ascending: false });
    if (error) { toast.error(error.message); setLoading(false); return; }
    const rows = (data as any as NoteAttachment[]) || [];
    // Sign URLs in parallel
    const withUrls = await Promise.all(rows.map(async (r) => {
      const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(r.storage_path, 3600);
      return { ...r, signed_url: s?.signedUrl };
    }));
    setItems(withUrls);
    setLoading(false);
  }, [noteId]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const upload = async (file: File) => {
    if (!noteId || !projectId) return null;
    const user = getAuthUser();
    if (!user) { toast.error("Not signed in"); return null; }
    if (file.size > 20 * 1024 * 1024) { toast.error("Max 20MB"); return null; }
    setUploading(true);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${user.id}/${noteId}/${Date.now()}_${safe}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || "application/octet-stream",
    });
    if (upErr) { toast.error(upErr.message); setUploading(false); return null; }
    const { data, error } = await supabase
      .from("project_note_attachments" as any)
      .insert({
        note_id: noteId,
        project_id: projectId,
        uploaded_by: user.id,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
      })
      .select()
      .single();
    setUploading(false);
    if (error) { toast.error(error.message); return null; }
    await fetchItems();
    return data as any as NoteAttachment;
  };

  const remove = async (att: NoteAttachment) => {
    const prev = items;
    setItems((p) => p.filter((i) => i.id !== att.id));
    await supabase.storage.from(BUCKET).remove([att.storage_path]);
    const { error } = await supabase.from("project_note_attachments" as any).delete().eq("id", att.id);
    if (error) { toast.error(error.message); setItems(prev); }
  };

  return { items, loading, uploading, upload, remove, refetch: fetchItems };
}
