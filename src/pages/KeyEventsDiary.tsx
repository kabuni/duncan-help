import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useKeyEvents, type KeyEvent, type KeyEventGoal } from "@/hooks/useKeyEvents";
import { useUserRoles } from "@/hooks/useUserRoles";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Calendar, ExternalLink, RefreshCw, AlertTriangle, CheckCircle2, ChevronRight, Plus, Trash2, Save, Target } from "lucide-react";
import { cn } from "@/lib/utils";

const RISK_TONE: Record<string, string> = {
  red: "bg-destructive/15 text-destructive border-destructive/30",
  amber: "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400",
  green: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
};

const FIELD_LABELS: Record<string, string> = {
  owner: "Owner",
  objective: "Objective",
  success_metric: "Success metric",
  decision_needed: "Decision needed",
  linked_docs: "Linked docs",
  risks: "Risks",
  next_action: "Next action",
};

function fmtDate(iso: string | null, allDay = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (allDay) return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function daysFromNow(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function EventRow({ ev, goals }: { ev: KeyEvent; goals: KeyEventGoal[] }) {
  const linkedGoals = goals.filter((g) => ev.linked_goal_ids.includes(g.id));
  const d = daysFromNow(ev.start_at);
  return (
    <div className="border border-border rounded-md p-3 bg-card hover:border-primary/40 transition-colors">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {ev.category && (
              <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider">{ev.category}</Badge>
            )}
            <h3 className="text-sm font-semibold text-foreground">{ev.event_name || ev.title}</h3>
            <Badge className={cn("border text-[10px]", RISK_TONE[ev.risk_level])}>{ev.risk_level}</Badge>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />{fmtDate(ev.start_at, ev.all_day)}
              {d !== null && d >= 0 && <span className="text-muted-foreground/70">· in {d}d</span>}
              {d !== null && d < 0 && <span className="text-muted-foreground/70">· {Math.abs(d)}d ago</span>}
            </span>
            {ev.owner ? (
              <span>Owner: <span className="text-foreground">{ev.owner}</span></span>
            ) : (
              <span className="text-destructive">Owner missing</span>
            )}
            {linkedGoals.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Target className="h-3 w-3" />
                {linkedGoals.map((g) => g.name).join(" · ")}
              </span>
            )}
          </div>
          {ev.risk_reason && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              <AlertTriangle className="h-3 w-3 inline mr-1 text-amber-500" />
              {ev.risk_reason}
            </p>
          )}
          {ev.missing_fields.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {ev.missing_fields.map((f) => (
                <Badge key={f} variant="outline" className="text-[10px] border-destructive/40 text-destructive">
                  Missing: {FIELD_LABELS[f] || f}
                </Badge>
              ))}
            </div>
          )}
          {(ev.objective || ev.success_metric || ev.decision_needed || ev.next_action) && (
            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-xs leading-6">
              {ev.objective && <div><span className="text-muted-foreground">Objective:</span> {ev.objective}</div>}
              {ev.success_metric && <div><span className="text-muted-foreground">Metric:</span> {ev.success_metric}</div>}
              {ev.decision_needed && <div><span className="text-muted-foreground">Decision:</span> {ev.decision_needed}</div>}
              {ev.next_action && <div><span className="text-muted-foreground">Next:</span> {ev.next_action}</div>}
            </div>
          )}
        </div>
        {ev.html_link && (
          <a href={ev.html_link} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1 shrink-0">
            Open <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

function Section({ title, events, goals, hint }: { title: string; events: KeyEvent[]; goals: KeyEventGoal[]; hint?: string }) {
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <span className="text-[11px] text-muted-foreground">{events.length}</span>
      </div>
      {hint && <p className="text-[11px] text-muted-foreground -mt-1">{hint}</p>}
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">Nothing here.</p>
      ) : (
        <div className="space-y-2">
          {events.map((e) => <EventRow key={e.id} ev={e} goals={goals} />)}
        </div>
      )}
    </Card>
  );
}

function GoalsAdmin({ goals, onChange }: { goals: KeyEventGoal[]; onChange: () => void }) {
  const [draft, setDraft] = useState({ name: "", description: "", target_date: "" });
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!draft.name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("key_event_goals" as any).insert({
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      target_date: draft.target_date || null,
      sort_order: (goals.at(-1)?.sort_order ?? 0) + 1,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setDraft({ name: "", description: "", target_date: "" });
    onChange();
  }

  async function update(g: KeyEventGoal, patch: Partial<KeyEventGoal>) {
    const { error } = await supabase.from("key_event_goals" as any).update(patch).eq("id", g.id);
    if (error) { toast.error(error.message); return; }
    onChange();
  }

  async function remove(g: KeyEventGoal) {
    if (!confirm(`Delete goal "${g.name}"?`)) return;
    const { error } = await supabase.from("key_event_goals" as any).delete().eq("id", g.id);
    if (error) { toast.error(error.message); return; }
    onChange();
  }

  return (
    <Card className="p-4 space-y-4">
      <h2 className="text-sm font-semibold tracking-tight">Company goals</h2>
      <div className="space-y-2">
        {goals.map((g) => (
          <div key={g.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start border border-border rounded-md p-2">
            <Input
              defaultValue={g.name}
              onBlur={(e) => e.target.value !== g.name && update(g, { name: e.target.value })}
              className="md:col-span-3 h-8 text-sm"
            />
            <Input
              defaultValue={g.description || ""}
              onBlur={(e) => e.target.value !== (g.description || "") && update(g, { description: e.target.value })}
              placeholder="Description"
              className="md:col-span-5 h-8 text-sm"
            />
            <Input
              type="date"
              defaultValue={g.target_date || ""}
              onBlur={(e) => e.target.value !== (g.target_date || "") && update(g, { target_date: e.target.value || null })}
              className="md:col-span-2 h-8 text-sm"
            />
            <select
              defaultValue={g.status}
              onChange={(e) => update(g, { status: e.target.value })}
              className="md:col-span-1 h-8 text-xs rounded-md border border-input bg-background px-2"
            >
              <option value="active">Active</option>
              <option value="achieved">Achieved</option>
              <option value="dropped">Dropped</option>
            </select>
            <Button variant="ghost" size="icon" className="md:col-span-1 h-8 w-8 justify-self-end" onClick={() => remove(g)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <div className="border-t border-border pt-3 space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Add goal</h3>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Goal name" className="md:col-span-3 h-8 text-sm" />
          <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Description" className="md:col-span-6 h-8 text-sm" />
          <Input type="date" value={draft.target_date} onChange={(e) => setDraft({ ...draft, target_date: e.target.value })} className="md:col-span-2 h-8 text-sm" />
          <Button size="sm" onClick={add} disabled={saving} className="md:col-span-1 h-8">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function KeyEventsDiary() {
  const { events, goals, status, lastSync, loading, syncing, refresh, connect, sync } = useKeyEvents();
  const { isAdmin } = useUserRoles();
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    const flag = params.get("duncan_calendar");
    if (!flag) return;
    if (flag === "connected") toast.success("Duncan calendar connected");
    else if (flag === "connected_no_calendar") toast.warning("Connected, but 'Duncan | Key Events' calendar not found in this Google account");
    else toast.error(`Calendar connection failed: ${params.get("reason") || "unknown"}`);
    params.delete("duncan_calendar");
    params.delete("reason");
    setParams(params, { replace: true });
  }, [params, setParams]);

  const sliced = useMemo(() => {
    const now = Date.now();
    const day = 86_400_000;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart.getTime() + day);
    const weekEnd = todayStart.getTime() + 7 * day;
    const monthEnd = todayStart.getTime() + 30 * day;

    const upcoming = events.filter((e) => e.start_at && new Date(e.start_at).getTime() >= now);
    const today = events.filter((e) => e.start_at && new Date(e.start_at) >= todayStart && new Date(e.start_at) < todayEnd);
    const week = upcoming.filter((e) => new Date(e.start_at!).getTime() < weekEnd);
    const month = upcoming.filter((e) => new Date(e.start_at!).getTime() < monthEnd);

    const launches = upcoming.filter((e) => (e.category || "").toLowerCase().includes("launch"));
    const indiaGoal = goals.find((g) => /india/i.test(g.name));
    const india = indiaGoal ? events.filter((e) => e.linked_goal_ids.includes(indiaGoal.id)) : [];
    const investor = events.filter((e) => /investor|board|fundrais/i.test(e.category || "") || /investor|board|fundrais/i.test(e.title));
    const atRisk = events.filter((e) => e.risk_level !== "green");
    const missing = events.filter((e) => e.missing_fields.includes("owner") || e.missing_fields.includes("next_action"));

    return { today, week, month, launches, india, investor, atRisk, missing };
  }, [events, goals]);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-4 lg:px-8 py-6 space-y-6">
        <header className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Duncan Key Events Diary</h1>
            <Badge variant="outline" className="font-mono text-[10px] uppercase">execution system</Badge>
          </div>
          <p className="text-sm text-muted-foreground leading-7">
            The single source of truth for Kabuni's strategic events, synced from <span className="font-semibold">Duncan | Key Events</span>.
            Not for meetings — only company-moving milestones.
          </p>
        </header>

        <Card className="p-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn("h-2 w-2 rounded-full", status?.connected ? "bg-emerald-500" : "bg-muted-foreground/40")} />
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">
                  {status?.connected ? `Connected as ${status.google_account_email || "Duncan"}` : "Not connected"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {status?.calendar_id
                    ? <>Calendar: <span className="font-mono">{status.calendar_name}</span></>
                    : status?.connected
                      ? <span className="text-amber-500">Calendar 'Duncan | Key Events' not found in this account.</span>
                      : "Admin must connect Duncan's Google account"}
                  {lastSync && <> · Last sync: {fmtDate(lastSync.finished_at || lastSync.started_at)} ({lastSync.status})</>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isAdmin && status?.connected && (
                <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
                  <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", syncing && "animate-spin")} />
                  {syncing ? "Syncing…" : "Sync now"}
                </Button>
              )}
              {isAdmin && (
                <Button size="sm" onClick={connect}>
                  {status?.connected ? "Reconnect" : "Connect Duncan calendar"}
                </Button>
              )}
            </div>
          </div>
        </Card>

        <Tabs defaultValue="dashboard">
          <TabsList>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="all">All events</TabsTrigger>
            {isAdmin && <TabsTrigger value="goals">Goals</TabsTrigger>}
          </TabsList>

          <TabsContent value="dashboard" className="space-y-4 mt-4">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Section title="Today" events={sliced.today} goals={goals} />
                <Section title="This week" events={sliced.week} goals={goals} />
                <Section title="Launch milestones" events={sliced.launches} goals={goals} hint="Category contains 'Launch'" />
                <Section title="India launch timeline" events={sliced.india} goals={goals} hint="Linked to the 'India product launch' goal" />
                <Section title="Investor & board" events={sliced.investor} goals={goals} />
                <Section title="Events at risk" events={sliced.atRisk} goals={goals} hint="Amber or red" />
                <Section title="Missing owners or next actions" events={sliced.missing} goals={goals} />
                <Section title="Upcoming (30 days)" events={sliced.month} goals={goals} />
              </div>
            )}
          </TabsContent>

          <TabsContent value="all" className="mt-4">
            <Card className="p-4 space-y-2">
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events synced yet.</p>
              ) : (
                events.map((e) => <EventRow key={e.id} ev={e} goals={goals} />)
              )}
            </Card>
          </TabsContent>

          {isAdmin && (
            <TabsContent value="goals" className="mt-4">
              <GoalsAdmin goals={goals} onChange={refresh} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppLayout>
  );
}
