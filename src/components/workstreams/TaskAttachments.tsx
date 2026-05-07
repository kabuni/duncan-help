import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Paperclip, Trash2, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

const sanitize = (fileName: string) => {
  const ext = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() ?? "" : "";
  const base = ext ? fileName.slice(0, -(ext.length + 1)) : fileName;
  const safe = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "file";
  return ext ? `${safe}.${ext}` : safe;
};

interface Attachment {
  id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

export function TaskAttachments({ taskId, compact = false }: { taskId: string; compact?: boolean }) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const { data, error } = await supabase
      .from("workstream_task_attachments" as any)
      .select("id, file_name, storage_path, mime_type, size_bytes, created_at")
      .eq("task_id", taskId)
      .order("created_at", { ascending: false });
    if (error) return;
    setItems((data as any) || []);
  }

  useEffect(() => { if (taskId) load(); /* eslint-disable-next-line */ }, [taskId]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const { data: u } = await supabase.auth.getUser();
    const userId = u.user?.id;
    if (!userId) { toast.error("Not signed in"); return; }
    setUploading(true);
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) { toast.error(`${file.name} exceeds 20MB`); continue; }
      const path = `${taskId}/${Date.now()}_${sanitize(file.name)}`;
      const { error: upErr } = await supabase.storage
        .from("workstream-task-attachments")
        .upload(path, file, { contentType: file.type || undefined });
      if (upErr) { toast.error(`Upload failed: ${file.name}`); continue; }
      const { error: insErr } = await supabase.from("workstream_task_attachments" as any).insert({
        task_id: taskId,
        uploaded_by: userId,
        file_name: file.name,
        storage_path: path,
        mime_type: file.type || null,
        size_bytes: file.size,
      });
      if (insErr) toast.error(`Saved file but record failed: ${file.name}`);
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    load();
  }

  async function download(att: Attachment) {
    const { data, error } = await supabase.storage
      .from("workstream-task-attachments")
      .createSignedUrl(att.storage_path, 60);
    if (error || !data?.signedUrl) { toast.error("Could not generate link"); return; }
    window.open(data.signedUrl, "_blank");
  }

  async function remove(att: Attachment) {
    if (!confirm(`Delete ${att.file_name}?`)) return;
    await supabase.storage.from("workstream-task-attachments").remove([att.storage_path]);
    const { error } = await supabase.from("workstream_task_attachments" as any).delete().eq("id", att.id);
    if (error) { toast.error("Delete failed"); return; }
    load();
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className={`${compact ? "text-[10px]" : "text-xs"} text-muted-foreground flex items-center gap-1`}>
          <Paperclip className="h-3 w-3" /> Attachments {items.length > 0 && `(${items.length})`}
        </span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="text-[10px] text-primary hover:underline inline-flex items-center gap-1 disabled:opacity-50"
        >
          {uploading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Paperclip className="h-2.5 w-2.5" />}
          Upload
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 border border-border/60 rounded-md px-2 py-1 text-[11px] bg-card/50"
            >
              <button
                onClick={() => download(a)}
                className="flex items-center gap-1.5 truncate text-left hover:text-primary"
                title={a.file_name}
              >
                <Download className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{a.file_name}</span>
              </button>
              <button
                onClick={() => remove(a)}
                className="text-muted-foreground hover:text-destructive shrink-0"
                title="Remove"
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
