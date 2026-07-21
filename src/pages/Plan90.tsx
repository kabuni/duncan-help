import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { usePlan90, PLAN90_PRIORITIES, PLAN90_STATUSES } from "@/hooks/usePlan90";
import type { Plan90Workstream } from "@/hooks/usePlan90";
import { supabase } from "@/integrations/supabase/client";
import { Plan90Overview } from "@/components/plan90/Plan90Overview";
import { Plan90Filters, emptyFilters } from "@/components/plan90/Plan90Filters";
import type { Plan90FilterState } from "@/components/plan90/Plan90Filters";
import { DeliverableRow } from "@/components/plan90/DeliverableRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

function useOwners() {
  return useQuery({
    queryKey: ["plan90-owners"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, display_name").not("display_name", "is", null).order("display_name");
      return (data || []).map((p: any) => ({ id: p.user_id as string, name: p.display_name as string }));
    },
    staleTime: 5 * 60_000,
  });
}

export default function Plan90() {
  const { user } = useAuth();
  const { isAdmin, isLoading: roleLoading } = useIsAdmin();
  const { workstreams, deliverables, loading, updateDeliverable, createDeliverable, deleteDeliverable, createWorkstream, updateWorkstream, deleteWorkstream } = usePlan90();
  const { data: owners = [] } = useOwners();
  const [filters, setFilters] = useState<Plan90FilterState>(emptyFilters);
  const [wsMgrOpen, setWsMgrOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const filteredDeliverables = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const monthAfterNext = new Date(today.getFullYear(), today.getMonth() + 2, 1);
    const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
    return deliverables.filter((d) => {
      if (d.archived) return false;
      if (filters.q && !d.title.toLowerCase().includes(filters.q.toLowerCase())) return false;
      if (filters.workstream !== "all" && d.workstream_id !== filters.workstream) return false;
      if (filters.status !== "all" && d.status !== filters.status) return false;
      if (filters.priority !== "all" && d.priority !== filters.priority) return false;
      if (filters.owner !== "all" && d.owner_user_id !== filters.owner) return false;
      if (filters.timeframe !== "all") {
        const due = d.due_date ? new Date(d.due_date) : null;
        if (!due) return false;
        if (filters.timeframe === "overdue" && !(due < today && d.status !== "Completed")) return false;
        if (filters.timeframe === "soon" && !(due >= today && due <= in7)) return false;
        if (filters.timeframe === "month" && !(due >= monthStart && due < nextMonthStart)) return false;
        if (filters.timeframe === "next" && !(due >= nextMonthStart && due < monthAfterNext)) return false;
        if (filters.timeframe === "later" && !(due >= monthAfterNext)) return false;
      }
      return true;
    });
  }, [deliverables, filters]);

  const activeWorkstreams = useMemo(() => workstreams.filter((w) => !w.archived), [workstreams]);

  if (!user) return null;

  return (
    <div className="min-h-full w-full p-4 sm:p-6 space-y-5 max-w-[1400px] mx-auto">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">90 Day Tracker</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Execution across workstreams for the 90-day plan.</p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setWsMgrOpen(true)}><Pencil className="h-3.5 w-3.5 mr-1.5" />Workstreams</Button>
            <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5 mr-1.5" />Add deliverable</Button>
          </div>
        )}
      </header>

      <Plan90Overview items={deliverables} />

      <Plan90Filters value={filters} onChange={setFilters} workstreams={activeWorkstreams} owners={owners} />

      {loading || roleLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…</div>
      ) : (
        <div className="space-y-3">
          {activeWorkstreams.map((ws) => {
            const items = filteredDeliverables.filter((d) => d.workstream_id === ws.id);
            if (filters.workstream !== "all" && filters.workstream !== ws.id) return null;
            return <WorkstreamSection key={ws.id} ws={ws} items={items} allWorkstreams={activeWorkstreams} owners={owners} isAdmin={isAdmin} onUpdate={updateDeliverable} onDelete={deleteDeliverable} defaultOpen={filters.workstream === ws.id || items.length > 0} />;
          })}
          {filteredDeliverables.length === 0 && !loading && (
            <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No deliverables match the current filters.</div>
          )}
        </div>
      )}

      {isAdmin && <AddDeliverableDialog open={addOpen} onOpenChange={setAddOpen} workstreams={activeWorkstreams} owners={owners} onCreate={createDeliverable} />}
      {isAdmin && <WorkstreamsDialog open={wsMgrOpen} onOpenChange={setWsMgrOpen} workstreams={workstreams} onCreate={createWorkstream} onUpdate={updateWorkstream} onDelete={deleteWorkstream} deliverables={deliverables} />}
    </div>
  );
}

function WorkstreamSection({ ws, items, allWorkstreams, owners, isAdmin, onUpdate, onDelete, defaultOpen }: any) {
  const [open, setOpen] = useState<boolean>(defaultOpen);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
  const done = items.filter((i: any) => i.status === "Completed").length;
  const inProg = items.filter((i: any) => i.status === "In Progress").length;
  const notStarted = items.filter((i: any) => i.status === "Not Started").length;
  const overdue = items.filter((i: any) => i.due_date && new Date(i.due_date) < today && i.status !== "Completed").length;
  const dueSoon = items.filter((i: any) => {
    if (!i.due_date || i.status === "Completed") return false;
    const d = new Date(i.due_date);
    return d >= today && d <= in7;
  }).length;
  const critical = items.filter((i: any) => i.priority === "Critical" && i.status !== "Completed").length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border border-border bg-card overflow-hidden">
      <CollapsibleTrigger className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/40 transition-colors text-left">
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform shrink-0", !open && "-rotate-90")} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold">{ws.name}</h2>
            <span className="text-[11px] text-muted-foreground">{items.length} total</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">{done} done</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">{inProg} in progress</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{notStarted} not started</span>
            {overdue > 0 && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 border border-red-500/30">{overdue} overdue</span>}
            {dueSoon > 0 && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30">{dueSoon} due ≤7d</span>}
            {critical > 0 && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-500 border border-orange-500/30">{critical} critical</span>}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 max-w-[200px] rounded-full bg-secondary overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
            <span className="text-[11px] text-muted-foreground">{pct}% complete</span>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {items.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground border-t border-border">No matching deliverables.</div>
        ) : (
          <div className="border-t border-border overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-secondary/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Deliverable</th>
                  <th className="text-left font-medium px-3 py-2">Owner</th>
                  <th className="text-left font-medium px-3 py-2">Due</th>
                  <th className="text-left font-medium px-3 py-2">Status</th>
                  <th className="text-left font-medium px-3 py-2">Priority</th>
                  <th className="text-left font-medium px-3 py-2">Workstream</th>
                  <th className="text-left font-medium px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it: any) => <DeliverableRow key={it.id} item={it} workstreams={allWorkstreams} owners={owners} isAdmin={isAdmin} onUpdate={onUpdate} onDelete={onDelete} />)}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function AddDeliverableDialog({ open, onOpenChange, workstreams, owners, onCreate }: any) {
  const [title, setTitle] = useState("");
  const [wsId, setWsId] = useState<string>(workstreams[0]?.id || "");
  const [ownerId, setOwnerId] = useState<string>("__none");
  const [status, setStatus] = useState<string>("Not Started");
  const [priority, setPriority] = useState<string>("Medium");
  const [due, setDue] = useState<Date | undefined>();
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!title.trim() || !wsId) { toast.error("Title and workstream required"); return; }
    setSaving(true);
    const owner = owners.find((o: any) => o.id === ownerId);
    const ok = await onCreate({ workstream_id: wsId, title: title.trim(), owner_user_id: ownerId === "__none" ? null : ownerId, owner_display_name: owner?.name || null, status, priority, due_date: due ? format(due, "yyyy-MM-dd") : null, notes: notes || null });
    setSaving(false);
    if (ok) { setTitle(""); setNotes(""); setDue(undefined); onOpenChange(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add deliverable</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><label className="text-xs text-muted-foreground">Title</label><Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs text-muted-foreground">Workstream</label>
              <Select value={wsId} onValueChange={setWsId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{workstreams.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><label className="text-xs text-muted-foreground">Owner</label>
              <Select value={ownerId} onValueChange={setOwnerId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none">Unassigned</SelectItem>{owners.map((o: any) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent></Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className="text-xs text-muted-foreground">Status</label>
              <Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PLAN90_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><label className="text-xs text-muted-foreground">Priority</label>
              <Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PLAN90_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><label className="text-xs text-muted-foreground">Due</label>
              <Popover><PopoverTrigger asChild><Button variant="outline" className="w-full justify-start font-normal">{due ? format(due, "d MMM yyyy") : "—"}</Button></PopoverTrigger><PopoverContent align="start" className="w-auto p-0"><Calendar mode="single" selected={due} onSelect={setDue} className="p-3 pointer-events-auto" /></PopoverContent></Popover>
            </div>
          </div>
          <div><label className="text-xs text-muted-foreground">Notes</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Add</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkstreamsDialog({ open, onOpenChange, workstreams, onCreate, onUpdate, onDelete, deliverables }: any) {
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Manage workstreams</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {workstreams.map((w: Plan90Workstream) => {
            const count = deliverables.filter((d: any) => d.workstream_id === w.id).length;
            return <WorkstreamRow key={w.id} ws={w} count={count} onUpdate={onUpdate} onDelete={onDelete} />;
          })}
        </div>
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <Input placeholder="New workstream name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button onClick={async () => { if (!newName.trim()) return; setSaving(true); const ok = await onCreate(newName.trim()); setSaving(false); if (ok) setNewName(""); }} disabled={saving}>Add</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WorkstreamRow({ ws, count, onUpdate, onDelete }: any) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(ws.name);
  return (
    <div className="flex items-center gap-2 border border-border/60 rounded-md px-3 py-2">
      {editing ? (
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" />
      ) : (
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{ws.name}</div>
          <div className="text-[10px] text-muted-foreground">{count} deliverable{count !== 1 && "s"}{ws.archived ? " · archived" : ""}</div>
        </div>
      )}
      {editing ? (
        <>
          <Button size="sm" variant="ghost" onClick={() => { setName(ws.name); setEditing(false); }}>Cancel</Button>
          <Button size="sm" onClick={async () => { await onUpdate(ws.id, { name }); setEditing(false); }}>Save</Button>
        </>
      ) : (
        <>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /></Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onUpdate(ws.id, { archived: !ws.archived })} title={ws.archived ? "Unarchive" : "Archive"}>
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 8v13H3V8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></svg>
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={async () => { if (count > 0) { toast.error("Move or delete deliverables first"); return; } if (confirm(`Delete workstream "${ws.name}"?`)) await onDelete(ws.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
        </>
      )}
    </div>
  );
}
