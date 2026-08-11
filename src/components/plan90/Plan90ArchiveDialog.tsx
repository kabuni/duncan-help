import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, RotateCcw, Archive } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { Plan90Deliverable, Plan90Workstream } from "@/hooks/usePlan90";
import { usePlan90Updates } from "@/hooks/usePlan90Updates";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  deliverables: Plan90Deliverable[];
  workstreams: Plan90Workstream[];
  isAdmin: boolean;
  onRestore: (id: string) => void;
}

export function Plan90ArchiveDialog({ open, onOpenChange, deliverables, workstreams, isAdmin, onRestore }: Props) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Plan90Deliverable | null>(null);
  const { listFor } = usePlan90Updates();
  const updates = selected ? listFor(selected.id) : [];

  const groups = useMemo(() => {
    const archived = deliverables.filter((d) => d.archived);
    const filtered = q
      ? archived.filter((d) => d.title.toLowerCase().includes(q.toLowerCase()))
      : archived;
    const map = new Map<string, { label: string; items: Plan90Deliverable[] }>();
    for (const d of filtered) {
      const raw = (d as any).completed_at || d.updated_at;
      const date = raw ? new Date(raw) : null;
      const key = date ? format(date, "yyyy-MM") : "unknown";
      const label = date ? format(date, "MMMM yyyy") : "Unknown date";
      if (!map.has(key)) map.set(key, { label, items: [] });
      map.get(key)!.items.push(d);
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, v]) => ({
        key,
        label: v.label,
        items: v.items.sort((a, b) => {
          const av = (a as any).completed_at || a.updated_at;
          const bv = (b as any).completed_at || b.updated_at;
          return av < bv ? 1 : -1;
        }),
      }));
  }, [deliverables, q]);

  const wsName = (id: string) => workstreams.find((w) => w.id === id)?.name || "—";
  const total = deliverables.filter((d) => d.archived).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="h-4 w-4" /> Archive — completed deliverables ({total})
          </DialogTitle>
        </DialogHeader>

        <Input placeholder="Search archive…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9" />

        <div className="space-y-2">
          {groups.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Nothing archived yet. Deliverables move here when marked Completed.
            </div>
          )}
          {groups.map((g, i) => (
            <MonthGroup key={g.key} label={g.label} count={g.items.length} defaultOpen={i === 0}>
              <ul className="divide-y divide-border/60">
                {g.items.map((d) => {
                  const raw = d.completed_at || d.updated_at;
                  return (
                    <li key={d.id} className="flex items-start justify-between gap-3 px-3 py-2 hover:bg-secondary/40 transition-colors">
                      <button type="button" className="min-w-0 text-left flex-1" onClick={() => setSelected(d)}>
                        <div className="text-sm leading-snug break-words hover:underline">{d.title}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {wsName(d.workstream_id)}
                          {d.owner_display_name ? ` · ${d.owner_display_name}` : ""}
                          {raw ? ` · Completed ${format(new Date(raw), "d MMM yyyy")}` : ""}
                        </div>
                      </button>
                      {isAdmin && (
                        <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs" onClick={() => onRestore(d.id)}>
                          <RotateCcw className="h-3 w-3 mr-1" />Restore
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </MonthGroup>
          ))}
        </div>
      </DialogContent>

      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base leading-snug pr-6">{selected?.title}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Workstream" value={wsName(selected.workstream_id)} />
                <Field label="Owner" value={selected.owner_display_name || "Unassigned"} />
                <Field label="Status" value={selected.status} />
                <Field label="Priority" value={selected.priority} />
                <Field label="Progress" value={`${selected.progress_percent ?? 0}%`} />
                <Field label="Due date" value={selected.due_date ? format(new Date(selected.due_date), "d MMM yyyy") : "—"} />
                <Field
                  label="Completed"
                  value={selected.completed_at ? format(new Date(selected.completed_at), "d MMM yyyy, HH:mm") : "—"}
                />
                <Field label="Last updated" value={format(new Date(selected.updated_at), "d MMM yyyy, HH:mm")} />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  Updates ({updates.length})
                </div>
                {updates.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                    No updates were posted on this deliverable.
                  </div>
                ) : (
                  <ul className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {updates.map((u) => (
                      <li key={u.id} className="rounded-md border border-border bg-secondary/30 p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={cn(
                              "h-2 w-2 rounded-full",
                              u.ryg === "green" && "bg-emerald-500",
                              u.ryg === "amber" && "bg-amber-500",
                              u.ryg === "red" && "bg-red-500",
                            )}
                          />
                          <span className="text-xs font-medium">{u.author_name}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {format(new Date(u.created_at), "d MMM yyyy, HH:mm")}
                          </span>
                        </div>
                        <div className="text-sm whitespace-pre-wrap">{u.message}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Notes</div>
                <div className="rounded-md border border-border bg-secondary/30 p-3 text-sm whitespace-pre-wrap">
                  {selected.notes?.trim() || "No notes recorded."}
                </div>
              </div>

              {isAdmin && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onRestore(selected.id);
                      setSelected(null);
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" />Restore
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm break-words">{value}</div>
    </div>
  );
}

function MonthGroup({ label, count, defaultOpen, children }: { label: string; count: number; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border bg-card overflow-hidden">
      <CollapsibleTrigger className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary/40 transition-colors text-left">
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", !open && "-rotate-90")} />
        <span className="text-sm font-medium">{label}</span>
        <span className="text-[11px] text-muted-foreground">{count} completed</span>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
