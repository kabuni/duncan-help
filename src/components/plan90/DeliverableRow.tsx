import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Plan90Deliverable, Plan90Workstream } from "@/hooks/usePlan90";
import { PLAN90_PRIORITIES, PLAN90_STATUSES } from "@/hooks/usePlan90";
import type { Plan90Ryg, Plan90Update } from "@/hooks/usePlan90Updates";
import { LatestUpdateCell } from "@/components/plan90/LatestUpdateCell";
import { DeliverableUpdatesDrawer } from "@/components/plan90/DeliverableUpdatesDrawer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { CalendarIcon, Trash2, Paperclip, Loader2, Download, X as XIcon, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Owner { id: string; name: string }

interface Props {
  item: Plan90Deliverable;
  workstreams: Plan90Workstream[];
  owners: Owner[];
  isAdmin: boolean;
  latestUpdate: Plan90Update | undefined;
  updates: Plan90Update[];
  currentUserId: string | null;
  onUpdate: (id: string, patch: Partial<Plan90Deliverable>) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onPostUpdate: (deliverableId: string, message: string, ryg: Plan90Ryg) => Promise<boolean>;
  onEditUpdate: (id: string, message: string, ryg: Plan90Ryg) => Promise<boolean>;
  onDeleteUpdate: (id: string) => Promise<boolean>;
}

const statusColor: Record<string, string> = {
  "Not Started": "bg-muted text-muted-foreground border-border",
  "In Progress": "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  "Completed": "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
};
const priorityColor: Record<string, string> = {
  Critical: "bg-red-500/10 text-red-500 border-red-500/30",
  High: "bg-orange-500/10 text-orange-500 border-orange-500/30",
  Medium: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  Low: "bg-muted text-muted-foreground border-border",
};

function sanitizeName(f: string) {
  const ext = f.includes(".") ? f.split(".").pop()!.toLowerCase() : "";
  const base = ext ? f.slice(0, -(ext.length + 1)) : f;
  const safe = base.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "file";
  return ext ? `${safe}.${ext}` : safe;
}

export function DeliverableRow({
  item, workstreams, owners, isAdmin,
  latestUpdate, updates, currentUserId,
  onUpdate, onDelete, onPostUpdate, onEditUpdate, onDeleteUpdate,
}: Props) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
  const dueDate = item.due_date ? new Date(item.due_date) : null;
  const isOverdue = !!dueDate && dueDate < today && item.status !== "Completed";
  const isDueSoon = !!dueDate && !isOverdue && dueDate >= today && dueDate <= in7 && item.status !== "Completed";
  const [editTitle, setEditTitle] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [attachOpen, setAttachOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  useEffect(() => { setTitle(item.title); }, [item.id, item.title]);

  const disabled = !isAdmin;

  return (
    <>
    <tr className={cn("border-b border-border/60 hover:bg-secondary/30 transition-colors", isOverdue && "bg-red-500/[0.03]", isDueSoon && "bg-yellow-500/[0.04]")}>
      <td className="px-3 py-2 align-top">
        {editTitle && isAdmin ? (
          <div className="flex items-center gap-1">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 text-sm" autoFocus onKeyDown={(e) => { if (e.key === "Enter") { onUpdate(item.id, { title }); setEditTitle(false); } if (e.key === "Escape") { setTitle(item.title); setEditTitle(false); } }} />
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { onUpdate(item.id, { title }); setEditTitle(false); }}><Save className="h-3.5 w-3.5" /></Button>
          </div>
        ) : (
          <button type="button" disabled={disabled} onClick={() => setEditTitle(true)} className={cn("text-sm text-left leading-snug break-words whitespace-normal", isAdmin && "hover:text-primary")}>{item.title}</button>
        )}
      </td>
      <td className="px-3 py-2 align-top w-[160px]">
        <Select disabled={disabled} value={item.owner_user_id || "__none"} onValueChange={(v) => {
          if (v === "__none") return onUpdate(item.id, { owner_user_id: null });
          const o = owners.find((x) => x.id === v);
          onUpdate(item.id, { owner_user_id: v, owner_display_name: o?.name || null });
        }}>
          <SelectTrigger className="h-8 text-xs"><SelectValue>{item.owner_user_id ? owners.find((o) => o.id === item.owner_user_id)?.name || item.owner_display_name : (item.owner_display_name || <span className="text-muted-foreground">Unassigned</span>)}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">Unassigned</SelectItem>
            {item.owner_display_name && !owners.find((o) => o.id === item.owner_user_id) && (
              <SelectItem value={item.owner_user_id || "__legacy"} disabled>{item.owner_display_name} (external)</SelectItem>
            )}
            {owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </td>
      <td className="px-3 py-2 align-top w-[140px]">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" disabled={disabled} className={cn("h-8 justify-start font-normal text-xs w-full", isOverdue && "text-red-500", isDueSoon && "text-yellow-600 dark:text-yellow-400")} title={isOverdue ? "Overdue" : isDueSoon ? "Due within 7 days" : undefined}>
              <CalendarIcon className="h-3 w-3 mr-1.5" />
              {item.due_date ? format(new Date(item.due_date), "d MMM yyyy") : "—"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0"><Calendar mode="single" selected={item.due_date ? new Date(item.due_date) : undefined} onSelect={(d) => d && onUpdate(item.id, { due_date: format(d, "yyyy-MM-dd") })} className="p-3 pointer-events-auto" /></PopoverContent>
        </Popover>
      </td>
      <td className="px-3 py-2 align-top w-[140px]">
        <Select disabled={disabled} value={item.status} onValueChange={(v) => onUpdate(item.id, { status: v })}>
          <SelectTrigger className={cn("h-8 text-xs border", statusColor[item.status] || "")}><SelectValue /></SelectTrigger>
          <SelectContent>{PLAN90_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </td>
      <td className="px-3 py-2 align-top w-[120px]">
        <Select disabled={disabled} value={item.priority} onValueChange={(v) => onUpdate(item.id, { priority: v })}>
          <SelectTrigger className={cn("h-8 text-xs border", priorityColor[item.priority] || "")}><SelectValue /></SelectTrigger>
          <SelectContent>{PLAN90_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
      </td>
      
      <td className="px-3 py-2 align-top w-[60px]">
        <LatestUpdateCell latest={latestUpdate} onOpen={() => setUpdatesOpen(true)} count={updates.length} />
      </td>
      <td className="px-3 py-2 align-top w-[70px]">
        <div className="flex items-center gap-1">
          <Popover open={attachOpen} onOpenChange={setAttachOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7"><Paperclip className="h-3.5 w-3.5" /></Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-3"><AttachmentsPanel deliverableId={item.id} isAdmin={isAdmin} /></PopoverContent>
          </Popover>
          {isAdmin && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={async () => { if (confirm(`Delete "${item.title}"?`)) await onDelete(item.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
          )}
        </div>
      </td>
    </tr>
    <DeliverableUpdatesDrawer
      open={updatesOpen}
      onOpenChange={setUpdatesOpen}
      deliverable={item}
      updates={updates}
      currentUserId={currentUserId}
      isAdmin={isAdmin}
      canPost={!!currentUserId}
      onPost={onPostUpdate}
      onEdit={onEditUpdate}
      onDelete={onDeleteUpdate}
    />
    </>
  );
}


function AttachmentsPanel({ deliverableId, isAdmin }: { deliverableId: string; isAdmin: boolean }) {
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
