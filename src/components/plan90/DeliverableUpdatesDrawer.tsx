import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, Pencil, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";
import type { Plan90Deliverable } from "@/hooks/usePlan90";
import type { Plan90Ryg, Plan90Update } from "@/hooks/usePlan90Updates";

const rygMeta: Record<Plan90Ryg, { label: string; dot: string; chip: string }> = {
  green: {
    label: "Green",
    dot: "bg-emerald-500",
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  amber: {
    label: "Amber",
    dot: "bg-amber-500",
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  red: {
    label: "Red",
    dot: "bg-red-500",
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
          <SheetTitle className="text-base leading-snug pr-8">{deliverable.title}</SheetTitle>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground pt-1">
            <span>Status: <span className="text-foreground">{deliverable.status}</span></span>
            <span>·</span>
            <span>Priority: <span className="text-foreground">{deliverable.priority}</span></span>
            {deliverable.due_date && (
              <>
                <span>·</span>
                <span>Due {format(new Date(deliverable.due_date), "d MMM yyyy")}</span>
              </>
            )}
          </div>
        </SheetHeader>

        {canPost && (
          <div className="px-5 py-4 border-b border-border bg-secondary/30">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Post update</label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="What's the latest? Progress, blockers, next steps…"
              className="mt-1.5 text-sm resize-none"
            />
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-1">
                {(Object.keys(rygMeta) as Plan90Ryg[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRyg(r)}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] border transition-colors",
                      ryg === r ? rygMeta[r].chip : "border-transparent text-muted-foreground hover:bg-secondary",
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", rygMeta[r].dot)} />
                    {rygMeta[r].label}
                  </button>
                ))}
              </div>
              <Button size="sm" onClick={submit} disabled={posting || !message.trim()}>
                {posting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Post
              </Button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {updates.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-10">
              No updates yet.{canPost && " Post the first one above."}
            </div>
          ) : (
            updates.map((u) => (
              <UpdateItem
                key={u.id}
                update={u}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function UpdateItem({
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

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center text-[11px] font-semibold shrink-0">
            {update.author_name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium truncate">{update.author_name}</div>
            <div
              className="text-[10px] text-muted-foreground"
              title={createdAt.toLocaleString()}
            >
              {formatDistanceToNow(createdAt, { addSuffix: true })}
            </div>
          </div>
        </div>
        <span
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0",
            meta.chip,
          )}
        >
          <span className={cn("inline-block h-1.5 w-1.5 rounded-full mr-1 align-middle", meta.dot)} />
          {meta.label}
        </span>
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="text-sm resize-none"
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              {(Object.keys(rygMeta) as Plan90Ryg[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setDraftRyg(r)}
                  className={cn(
                    "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border",
                    draftRyg === r ? rygMeta[r].chip : "border-transparent text-muted-foreground hover:bg-secondary",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", rygMeta[r].dot)} />
                  {rygMeta[r].label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => {
                  setEditing(false);
                  setDraft(update.message);
                  setDraftRyg(update.ryg);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" className="h-7 w-7" onClick={save} disabled={saving || !draft.trim()}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-1.5 text-sm text-foreground whitespace-pre-wrap leading-snug">
          {update.message}
        </div>
      )}

      {!editing && (canEdit || canDelete) && (
        <div className="flex items-center gap-1 justify-end mt-1.5">
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[10px] text-muted-foreground hover:text-primary inline-flex items-center gap-1"
            >
              <Pencil className="h-3 w-3" /> Edit
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={async () => {
                if (confirm("Delete this update?")) await onDelete(update.id);
              }}
              className="text-[10px] text-muted-foreground hover:text-destructive inline-flex items-center gap-1 ml-2"
            >
              <Trash2 className="h-3 w-3" /> Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
