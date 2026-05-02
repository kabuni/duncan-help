import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Calendar as RBCalendar, dateFnsLocalizer, View } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "@/components/diary/calendar.css";

import AppLayout from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useKeyEvents, type KeyEvent, type KeyEventGoal } from "@/hooks/useKeyEvents";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { toast } from "sonner";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { GoalsPanel } from "@/components/diary/GoalsPanel";
import { DetailDrawer } from "@/components/diary/DetailDrawer";

const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales });

type CalItem = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  resource: { kind: "event"; data: KeyEvent } | { kind: "goal"; data: KeyEventGoal };
};

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function KeyEventsDiary() {
  const { events, goals, status, lastSync, loading, syncing, refresh, connect, sync } = useKeyEvents();
  const { isAdmin } = useIsAdmin();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>("month");
  const [date, setDate] = useState<Date>(new Date());
  const [riskFilter, setRiskFilter] = useState<"all" | "atrisk">("all");
  const [selectedEvent, setSelectedEvent] = useState<KeyEvent | null>(null);
  const [selectedGoal, setSelectedGoal] = useState<KeyEventGoal | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  const calItems = useMemo<CalItem[]>(() => {
    const filteredEvents = riskFilter === "atrisk"
      ? events.filter((e) => e.risk_level !== "green")
      : events;

    const evItems: CalItem[] = filteredEvents
      .filter((e) => e.start_at)
      .map((e) => {
        const start = new Date(e.start_at!);
        const end = e.end_at ? new Date(e.end_at) : new Date(start.getTime() + 60 * 60 * 1000);
        return {
          id: `event:${e.id}`,
          title: e.event_name || e.title,
          start,
          end,
          allDay: e.all_day,
          resource: { kind: "event", data: e },
        };
      });

    const goalItems: CalItem[] = goals
      .filter((g) => g.target_date && g.status === "active")
      .map((g) => {
        const start = new Date(g.target_date + "T00:00:00");
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        return {
          id: `goal:${g.id}`,
          title: `🎯 ${g.name}`,
          start,
          end,
          allDay: true,
          resource: { kind: "goal", data: g },
        };
      });

    return [...goalItems, ...evItems];
  }, [events, goals, riskFilter]);

  const counts = useMemo(() => {
    const red = events.filter((e) => e.risk_level === "red").length;
    const amber = events.filter((e) => e.risk_level === "amber").length;
    const missing = events.filter((e) => e.missing_fields.includes("owner") || e.missing_fields.includes("next_action")).length;
    return { red, amber, missing };
  }, [events]);

  function handleSelectItem(item: CalItem) {
    if (item.resource.kind === "event") {
      setSelectedEvent(item.resource.data);
      setSelectedGoal(null);
    } else {
      setSelectedGoal(item.resource.data);
      setSelectedEvent(null);
    }
    setDrawerOpen(true);
  }

  function handleSelectGoal(g: KeyEventGoal) {
    setSelectedGoal(g);
    setSelectedEvent(null);
    setDrawerOpen(true);
    if (g.target_date) setDate(new Date(g.target_date + "T00:00:00"));
  }

  const goalEventsForSelected = useMemo(() => {
    if (!selectedGoal) return [];
    return events.filter((e) => e.linked_goal_ids.includes(selectedGoal.id));
  }, [selectedGoal, events]);

  const eventPropGetter = (item: CalItem) => {
    if (item.resource.kind === "goal") return { className: "evt-goal" };
    const lvl = item.resource.data.risk_level;
    return { className: `evt-${lvl}` };
  };

  return (
    <AppLayout>
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-6 space-y-4">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Duncan Key Events Diary</h1>
            <Badge variant="outline" className="font-mono text-[10px] uppercase">execution system</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Strategic events synced from <span className="font-semibold">Duncan | Key Events</span>. Goal target dates appear as pinned markers.
          </p>
        </header>

        <Card className="p-3">
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
                      ? <span className="text-amber-500">'Duncan | Key Events' calendar not found in this account.</span>
                      : "Admin must connect Duncan's Google account"}
                  {lastSync && <> · Last sync: {fmtDateTime(lastSync.finished_at || lastSync.started_at)} ({lastSync.status})</>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {(counts.red > 0 || counts.amber > 0 || counts.missing > 0) && (
                <button
                  onClick={() => setRiskFilter(riskFilter === "atrisk" ? "all" : "atrisk")}
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs border rounded-md px-2 py-1 transition-colors",
                    riskFilter === "atrisk"
                      ? "bg-destructive/10 border-destructive/40 text-destructive"
                      : "border-border text-muted-foreground hover:bg-accent"
                  )}
                >
                  <AlertTriangle className="h-3 w-3" />
                  {counts.red} red · {counts.amber} amber · {counts.missing} missing owner
                  {riskFilter === "atrisk" && " (filter on)"}
                </button>
              )}
              {isAdmin && status?.connected && (
                <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
                  <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", syncing && "animate-spin")} />
                  {syncing ? "Syncing…" : "Sync"}
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

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 items-start">
          <Card className="p-3">
            {loading ? (
              <p className="text-sm text-muted-foreground p-8 text-center">Loading…</p>
            ) : (
              <div style={{ height: "calc(100vh - 280px)", minHeight: 560 }}>
                <RBCalendar
                  localizer={localizer}
                  events={calItems}
                  startAccessor="start"
                  endAccessor="end"
                  allDayAccessor="allDay"
                  view={view}
                  onView={setView}
                  date={date}
                  onNavigate={setDate}
                  views={["month", "week", "day", "agenda"]}
                  popup
                  eventPropGetter={eventPropGetter as any}
                  onSelectEvent={handleSelectItem as any}
                  tooltipAccessor={(item: any) => {
                    if (item.resource?.kind === "goal") return `Goal target: ${item.resource.data.name}`;
                    const ev = item.resource?.data as KeyEvent;
                    return `${ev.event_name || ev.title}${ev.owner ? ` · ${ev.owner}` : ""}${ev.risk_reason ? ` · ${ev.risk_reason}` : ""}`;
                  }}
                />
              </div>
            )}
          </Card>

          <GoalsPanel
            goals={goals}
            events={events}
            isAdmin={isAdmin}
            onChange={refresh}
            onSelectGoal={handleSelectGoal}
          />
        </div>

        <DetailDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          event={selectedEvent}
          goal={selectedGoal}
          goalEvents={goalEventsForSelected}
          goals={goals}
        />
      </div>
    </AppLayout>
  );
}
