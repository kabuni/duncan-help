import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Paperclip, Loader2, Download, X as XIcon } from "lucide-react";
import { toast } from "sonner";

function sanitizeName(f: string) {
  const ext = f.includes(".") ? f.split(".").pop()!.toLowerCase() : "";
  const base = ext ? f.slice(0, -(ext.length + 1)) : f;
  const safe = base.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "file";
  return ext ? `${safe}.${ext}` : safe;
}

export function AttachmentsPanel({ deliverableId, isAdmin }: { deliverableId: string; isAdmin: boolean }) {
  const [items, setItems] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("plan90_attachments" as any).select("*").eq("deliverable_id", deliverableId).order("created_at", { ascending: false });
    setItems((data as any) || []);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [deliverableId]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    setUploading(true);
    for (const f of Array.from(files)) {
      if (f.size > 20 * 1024 * 1024) { toast.error(`${f.name} > 20MB`); continue; }
      const path = `${deliverableId}/${Date.now()}_${sanitizeName(f.name)}`;
      const { error } = await supabase.storage.from("plan90-attachments").upload(path, f, { contentType: f.type || undefined });
      if (error) { toast.error(`Upload failed: ${f.name}`); continue; }
      await supabase.from("plan90_attachments" as any).insert({ deliverable_id: deliverableId, uploaded_by: u.user.id, file_name: f.name, storage_path: path, mime_type: f.type || null, size_bytes: f.size });
    }
    setUploading(false); load();
  }

  async function download(a: any) {
    const { data, error } = await supabase.storage.from("plan90-attachments").createSignedUrl(a.storage_path, 60);
    if (error || !data?.signedUrl) { toast.error("Link failed"); return; }
    window.open(data.signedUrl, "_blank");
  }

  async function remove(a: any) {
    if (!confirm(`Remove ${a.file_name}?`)) return;
    await supabase.storage.from("plan90-attachments").remove([a.storage_path]);
    await supabase.from("plan90_attachments" as any).delete().eq("id", a.id);
    load();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Attachments ({items.length})</span>
        {isAdmin && (
          <label className="text-[11px] text-primary hover:underline cursor-pointer inline-flex items-center gap-1">
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />} Upload
            <input type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          </label>
        )}
      </div>
      {items.length === 0 && <div className="text-[11px] text-muted-foreground">No files</div>}
      <ul className="space-y-1">
        {items.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 border border-border/60 rounded-md px-2 py-1 text-[11px]">
            <button onClick={() => download(a)} className="flex items-center gap-1.5 truncate text-left hover:text-primary"><Download className="h-3 w-3 shrink-0" /><span className="truncate">{a.file_name}</span></button>
            {isAdmin && <button onClick={() => remove(a)} className="text-muted-foreground hover:text-destructive"><XIcon className="h-3 w-3" /></button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
