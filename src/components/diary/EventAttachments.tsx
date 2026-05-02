import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Paperclip, Trash2, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

const sanitizeFileName = (fileName: string) => {
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

interface Props {
  eventId: string;
}

export function EventAttachments({ eventId }: Props) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("key_event_attachments" as any)
      .select("id, file_name, storage_path, mime_type, size_bytes, created_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error("Could not load attachments");
      return;
    }
    setItems((data as any) || []);
  }

  useEffect(() => { if (eventId) load(); /* eslint-disable-next-line */ }, [eventId]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      toast.error("Not signed in");
      return;
    }
    setUploading(true);
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) {
        toast.error(`${file.name} exceeds 20MB`);
        continue;
      }
      const path = `${eventId}/${Date.now()}_${sanitizeFileName(file.name)}`;
      const { error: upErr } = await supabase.storage
        .from("key-event-attachments")
        .upload(path, file, { contentType: file.type || undefined });
      if (upErr) {
        toast.error(`Upload failed: ${file.name}`);
        continue;
      }
      const { error: insErr } = await supabase.from("key_event_attachments" as any).insert({
        event_id: eventId,
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
    toast.success("Attachments uploaded");
    load();
  }

  async function download(att: Attachment) {
    const { data, error } = await supabase.storage
      .from("key-event-attachments")
      .createSignedUrl(att.storage_path, 60);
    if (error || !data?.signedUrl) {
      toast.error("Could not generate download link");
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  async function remove(att: Attachment) {
    if (!confirm(`Delete ${att.file_name}?`)) return;
    await supabase.storage.from("key-event-attachments").remove([att.storage_path]);
    const { error } = await supabase.from("key_event_attachments" as any).delete().eq("id", att.id);
    if (error) {
      toast.error("Delete failed");
      return;
    }
    toast.success("Removed");
    load();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">Attachments</div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="h-7 text-xs"
        >
          {uploading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Paperclip className="h-3 w-3 mr-1" />}
          Upload
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground italic">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No files attached</p>
      ) : (
        <ul className="space-y-1">
          {items.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 border border-border rounded-md px-2 py-1.5 text-xs">
              <button
                onClick={() => download(a)}
                className="flex items-center gap-1.5 truncate text-left hover:text-primary"
                title={a.file_name}
              >
                <Download className="h-3 w-3 shrink-0" />
                <span className="truncate">{a.file_name}</span>
              </button>
              <button
                onClick={() => remove(a)}
                className="text-muted-foreground hover:text-destructive shrink-0"
                title="Remove"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
