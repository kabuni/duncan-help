import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, RotateCcw, Archive } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { Plan90Deliverable, Plan90Workstream } from "@/hooks/usePlan90";

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
                  const raw = (d as any).completed_at || d.updated_at;
                  return (
                    <li key={d.id} className="flex items-start justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm leading-snug break-words">{d.title}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {wsName(d.workstream_id)}
                          {d.owner_display_name ? ` · ${d.owner_display_name}` : ""}
                          {raw ? ` · Completed ${format(new Date(raw), "d MMM yyyy")}` : ""}
                        </div>
                      </div>
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
    </Dialog>
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
