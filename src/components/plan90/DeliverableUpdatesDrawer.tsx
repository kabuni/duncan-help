import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, Pencil, X, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format, isToday, isYesterday } from "date-fns";
import type { Plan90Deliverable } from "@/hooks/usePlan90";
import type { Plan90Ryg, Plan90Update } from "@/hooks/usePlan90Updates";

const rygMeta: Record<Plan90Ryg, { label: string; dot: string; ring: string; chip: string }> = {
  green: {
    label: "Green",
    dot: "bg-emerald-500",
    ring: "ring-emerald-500/40",
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  amber: {
    label: "Amber",
    dot: "bg-amber-500",
    ring: "ring-amber-500/40",
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  red: {
    label: "Red",
    dot: "bg-red-500",
    ring: "ring-red-500/40",
    chip: "bg-red-500/10 text-red-500 border-red-500/30",
  },
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  deliverable: Plan90Deliverable;
  updates: Plan90Update[];
  currentUserId: string | null;
  isAdmin: boolean;
  canPost: boolean;
  onPost: (deliverableId: string, message: string, ryg: Plan90Ryg) => Promise<boolean>;
  onEdit: (id: string, message: string, ryg: Plan90Ryg) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}

function groupByDay(updates: Plan90Update[]) {
  const groups: { label: string; items: Plan90Update[] }[] = [];
  for (const u of updates) {
    const d = new Date(u.created_at);
    const label = isToday(d) ? "Today" : isYesterday(d) ? "Yesterday" : format(d, "d MMM yyyy");
    let g = groups[groups.length - 1];
    if (!g || g.label !== label) {
      g = { label, items: [] };
      groups.push(g);
    }
    g.items.push(u);
  }
  return groups;
}

export function DeliverableUpdatesDrawer({
  open,
  onOpenChange,
  deliverable,
  updates,
  currentUserId,
  isAdmin,
  canPost,
  onPost,
  onEdit,
  onDelete,
}: Props) {
  const [message, setMessage] = useState("");
  const [ryg, setRyg] = useState<Plan90Ryg>("amber");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!open) {
      setMessage("");
      setRyg("amber");
    }
  }, [open]);

  async function submit() {
    if (!message.trim()) return;
    setPosting(true);
    const ok = await onPost(deliverable.id, message, ryg);
    setPosting(false);
    if (ok) {
      setMessage("");
      setRyg("amber");
    }
  }

  const grouped = groupByDay(updates);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[95vw] p-0 flex flex-col max-h-[85vh] gap-0">
        <DialogHeader className="px-4 pt-4 pb-2 border-b border-border space-y-1">
          <DialogTitle className="text-sm font-semibold leading-snug pr-8 text-left">{deliverable.title}</DialogTitle>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground flex-wrap">
            <span className="px-1.5 py-0.5 rounded bg-secondary text-foreground">{deliverable.status}</span>
            <span className="px-1.5 py-0.5 rounded bg-secondary text-foreground">{deliverable.priority}</span>
            {deliverable.due_date && (
              <span className="px-1.5 py-0.5 rounded bg-secondary text-foreground">
                Due {format(new Date(deliverable.due_date), "d MMM")}
              </span>
            )}
            <span className="ml-auto">{updates.length} update{updates.length !== 1 && "s"}</span>
          </div>
        </DialogHeader>

        {canPost && (
          <div className="px-4 py-2.5 border-b border-border bg-secondary/30">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
              }}
              rows={2}
              placeholder="Post an update… (⌘/Ctrl + Enter)"
              className="text-sm resize-none min-h-[52px]"
            />
            <div className="flex items-center justify-between mt-1.5">
              <div className="flex items-center gap-0.5">
                {(Object.keys(rygMeta) as Plan90Ryg[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRyg(r)}
                    title={rygMeta[r].label}
                    className={cn(
                      "h-6 w-6 rounded-full flex items-center justify-center transition-all",
                      ryg === r ? `ring-2 ${rygMeta[r].ring}` : "opacity-50 hover:opacity-100",
                    )}
                  >
                    <span className={cn("h-2.5 w-2.5 rounded-full", rygMeta[r].dot)} />
                  </button>
                ))}
                <span className="text-[10px] text-muted-foreground ml-1.5">{rygMeta[ryg].label}</span>
              </div>
              <Button size="sm" className="h-7 px-3 text-xs" onClick={submit} disabled={posting || !message.trim()}>
                {posting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Post
              </Button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {updates.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-10 px-4">
              No updates yet.{canPost && " Post the first one above."}
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.label}>
                <div className="sticky top-0 z-10 px-4 py-1 text-[10px] uppercase tracking-wider text-muted-foreground bg-background/95 backdrop-blur border-b border-border/60">
                  {group.label}
                </div>
                <ul className="divide-y divide-border/60">
                  {group.items.map((u) => (
                    <UpdateRow
                      key={u.id}
                      update={u}
                      currentUserId={currentUserId}
                      isAdmin={isAdmin}
                      onEdit={onEdit}
                      onDelete={onDelete}
                    />
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UpdateRow({
  update,
  currentUserId,
  isAdmin,
  onEdit,
  onDelete,
}: {
  update: Plan90Update;
  currentUserId: string | null;
  isAdmin: boolean;
  onEdit: (id: string, message: string, ryg: Plan90Ryg) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const meta = rygMeta[update.ryg];
  const createdAt = new Date(update.created_at);
  const isAuthor = !!currentUserId && update.author_id === currentUserId;
  const withinEditWindow = Date.now() - createdAt.getTime() < 15 * 60 * 1000;
  const canEdit = isAuthor && withinEditWindow;
  const canDelete = (isAuthor && withinEditWindow) || isAdmin;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(update.message);
  const [draftRyg, setDraftRyg] = useState<Plan90Ryg>(update.ryg);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setDraft(update.message);
    setDraftRyg(update.ryg);
  }, [update.message, update.ryg]);

  async function save() {
    setSaving(true);
    const ok = await onEdit(update.id, draft, draftRyg);
    setSaving(false);
    if (ok) setEditing(false);
  }

  const isLong = update.message.length > 140 || update.message.includes("\n");
  const firstName = update.author_name.split(/\s+/)[0] || update.author_name;
  const relTime = formatDistanceToNow(createdAt, { addSuffix: false })
    .replace("about ", "")
    .replace(" minutes", "m").replace(" minute", "m")
    .replace(" hours", "h").replace(" hour", "h")
    .replace(" days", "d").replace(" day", "d")
    .replace(" months", "mo").replace(" month", "mo");

  return (
    <li className="group px-4 py-2 hover:bg-secondary/30 transition-colors">
      {/* Compact header line */}
      <div className="flex items-center gap-2 text-[11px]">
        <span className={cn("h-2 w-2 rounded-full shrink-0", meta.dot)} title={meta.label} />
        <span className="font-medium text-foreground truncate">{firstName}</span>
        <span className="text-muted-foreground" title={createdAt.toLocaleString()}>{relTime}</span>
        <span className={cn("ml-auto text-[10px] px-1 rounded border font-medium", meta.chip)}>{meta.label}</span>
      </div>

      {editing ? (
        <div className="mt-1.5 space-y-1.5">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="text-sm resize-none"
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-0.5">
              {(Object.keys(rygMeta) as Plan90Ryg[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setDraftRyg(r)}
                  className={cn(
                    "h-5 w-5 rounded-full flex items-center justify-center",
                    draftRyg === r ? `ring-2 ${rygMeta[r].ring}` : "opacity-50 hover:opacity-100",
                  )}
                >
                  <span className={cn("h-2 w-2 rounded-full", rygMeta[r].dot)} />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => {
                  setEditing(false);
                  setDraft(update.message);
                  setDraftRyg(update.ryg);
                }}
              >
                <X className="h-3 w-3" />
              </Button>
              <Button size="icon" className="h-6 w-6" onClick={save} disabled={saving || !draft.trim()}>
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-0.5 pl-4">
          <div className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">
            {update.message}
          </div>
        </div>
      )}

      {!editing && (canEdit || canDelete) && (
        <div className="pl-4 mt-0.5 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[10px] text-muted-foreground hover:text-primary inline-flex items-center gap-0.5"
            >
              <Pencil className="h-2.5 w-2.5" /> Edit
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={async () => {
                if (confirm("Delete this update?")) await onDelete(update.id);
              }}
              className="text-[10px] text-muted-foreground hover:text-destructive inline-flex items-center gap-0.5"
            >
              <Trash2 className="h-2.5 w-2.5" /> Delete
            </button>
          )}
        </div>
      )}
    </li>
  );
}
