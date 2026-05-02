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
import { useKeyEvents, type KeyEvent, type WorkstreamCard } from "@/hooks/useKeyEvents";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { toast } from "sonner";
import { RefreshCw, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { DetailDrawer } from "@/components/diary/DetailDrawer";
import { AddEventDialog } from "@/components/diary/AddEventDialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatTimeInTz } from "@/components/diary/TimezonePicker";
import { CATEGORY_META, getCategoryMeta } from "@/components/diary/categoryMeta";

type ViewTz = "Europe/London" | "Asia/Kolkata" | "both";
const VIEW_TZ_KEY = "planner_view_tz";

function detectDefaultViewTz(): ViewTz {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === "Asia/Kolkata") return "Asia/Kolkata";
  } catch {}
  return "Europe/London";
}

const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales });

function PlannerToolbar(props: any) {
  const { label, onNavigate, onView, view, views } = props;
  return (
    <div className="rbc-toolbar">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => onNavigate("PREV")} aria-label="Previous">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="rbc-toolbar-label px-2 min-w-[140px] text-center">{label}</span>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => onNavigate("NEXT")} aria-label="Next">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 ml-1 text-xs" onClick={() => onNavigate("TODAY")}>
          Today
        </Button>
      </div>
      <div className="flex items-center gap-1">
        {(views as string[]).map((v) => (
          <Button
            key={v}
            variant={view === v ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs capitalize"
            onClick={() => onView(v)}
          >
            {v}
          </Button>
        ))}
      </div>
    </div>
  );
}

type CalItem = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  resource: { kind: "event"; data: KeyEvent };
};

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function KeyEventsDiary() {
  const { events, cards, status, lastSync, loading, syncing, refresh, connect, sync } = useKeyEvents();
  const { isAdmin } = useIsAdmin();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>("month");
  const [date, setDate] = useState<Date>(new Date());
  const [riskFilter, setRiskFilter] = useState<"all" | "atrisk">("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [selectedEvent, setSelectedEvent] = useState<KeyEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState<Date | null>(null);
  const [viewTz, setViewTzState] = useState<ViewTz>(() => {
    if (typeof window === "undefined") return "Europe/London";
    return (localStorage.getItem(VIEW_TZ_KEY) as ViewTz | null) || detectDefaultViewTz();
  });
  const setViewTz = (v: ViewTz) => {
    setViewTzState(v);
    try { localStorage.setItem(VIEW_TZ_KEY, v); } catch {}
  };

  useEffect(() => {
    const flag = params.get("duncan_calendar");
    if (!flag) return;
    if (flag === "connected") toast.success("Duncan calendar connected");
    else if (flag === "connected_no_calendar") toast.warning("Connected, but 'Duncan | Planner' calendar not found in this Google account");
    else toast.error(`Calendar connection failed: ${params.get("reason") || "unknown"}`);
    params.delete("duncan_calendar");
    params.delete("reason");
    setParams(params, { replace: true });
  }, [params, setParams]);

  // Deep-link: /diary?event=<id> opens the detail drawer for that event.
  useEffect(() => {
    const eventId = params.get("event");
    if (!eventId || !events.length) return;
    const found = events.find((e) => e.id === eventId);
    if (found) {
      setSelectedEvent(found);
      setDrawerOpen(true);
      params.delete("event");
      setParams(params, { replace: true });
    }
  }, [params, events, setParams]);

  const owners = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => { if (e.owner) set.add(e.owner); });
    return Array.from(set).sort();
  }, [events]);

  const calItems = useMemo<CalItem[]>(() => {
    let filteredEvents = riskFilter === "atrisk"
      ? events.filter((e) => e.risk_level !== "green")
      : events;
    if (ownerFilter !== "all") {
      filteredEvents = filteredEvents.filter((e) => (e.owner || "") === ownerFilter);
    }

    const CAT_ICON: Record<string, string> = {
      Travel: "✈️",
      Holiday: "🏖️",
      Marketing: "📣",
      Launch: "🚀",
      Investor: "💼",
      Product: "🛠️",
      Operations: "⚙️",
      Releases: "📦",
      Event: "📌",
    };

    const evItems: CalItem[] = filteredEvents
      .filter((e) => e.start_at)
      .map((e) => {
        const start = new Date(e.start_at!);
        const end = e.end_at ? new Date(e.end_at) : new Date(start.getTime() + 60 * 60 * 1000);
        const name = e.event_name || e.title;
        const icon = e.category ? (CAT_ICON[e.category] || "📌") : "📌";
        const cat = e.category ? ` [${e.category}]` : "";
        const owner = e.owner ? ` · ${e.owner}` : "";
        const tz = e.start_tz && e.start_tz !== "Europe/London" ? ` · ${e.start_tz.split("/").pop()?.replace(/_/g, " ")}` : "";
        return {
          id: `event:${e.id}`,
          title: `${icon} ${name}${cat}${owner}${tz}`,
          start,
          end,
          allDay: e.all_day,
          resource: { kind: "event", data: e },
        };
      });

    return evItems;
  }, [events, riskFilter, ownerFilter]);


  function handleSelectItem(item: CalItem) {
    setSelectedEvent(item.resource.data);
    setDrawerOpen(true);
  }

  const eventPropGetter = (item: CalItem) => {
    const lvl = item.resource.data.risk_level;
    return { className: `evt-${lvl}` };
  };

  const EventChip = ({ event }: { event: CalItem }) => {
    const ev = event.resource.data;
    const name = ev.event_name || ev.title;
    const isAllDay = ev.all_day;
    if (viewTz === "both") {
      return (
        <div className="leading-tight">
          <div className="truncate font-medium">{name}</div>
          {!isAllDay && (
            <div className="flex flex-col text-[10px] opacity-90 mt-0.5">
              <span>🇬🇧 {formatTimeInTz(ev.start_at, "Europe/London")}</span>
              <span>🇮🇳 {formatTimeInTz(ev.start_at, "Asia/Kolkata")}</span>
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="leading-tight">
        <div className="truncate font-medium">{name}</div>
        {!isAllDay && (
          <div className="text-[10px] opacity-90">
            {formatTimeInTz(ev.start_at, viewTz)}
          </div>
        )}
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-4 md:py-6 flex flex-col gap-4 h-[calc(100dvh-3.5rem)]">
        <header className="space-y-1 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">Duncan Planner</h1>
            <Badge variant="outline" className="font-mono text-[10px] uppercase">execution system</Badge>
          </div>
          <p className="text-xs md:text-sm text-muted-foreground">
            Strategic events synced from <span className="font-semibold">Duncan | Planner</span>. Goal target dates appear as pinned markers.
          </p>
        </header>

        <Card className="p-3 shrink-0">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn("h-2 w-2 rounded-full shrink-0", status?.connected ? "bg-emerald-500" : "bg-muted-foreground/40")} />
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">
                  {status?.connected ? `Connected as ${status.google_account_email || "Duncan"}` : "Not connected"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {status?.calendar_id
                    ? <>Calendar: <span className="font-mono">{status.calendar_name}</span></>
                    : status?.connected
                      ? <span className="text-amber-500">'Duncan | Planner' calendar not found in this account.</span>
                      : "Admin must connect Duncan's Google account"}
                  {lastSync && <> · Last sync: {fmtDateTime(lastSync.finished_at || lastSync.started_at)} ({lastSync.status})</>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap md:flex-nowrap md:justify-end">
              <ToggleGroup
                type="single"
                size="sm"
                value={viewTz}
                onValueChange={(v) => v && setViewTz(v as ViewTz)}
                className="h-8 border border-border rounded-md p-0.5"
              >
                <ToggleGroupItem value="Europe/London" className="h-7 px-2 text-xs gap-1" aria-label="View in UK time">
                  <span aria-hidden>🇬🇧</span> UK
                </ToggleGroupItem>
                <ToggleGroupItem value="Asia/Kolkata" className="h-7 px-2 text-xs gap-1" aria-label="View in India time">
                  <span aria-hidden>🇮🇳</span> IN
                </ToggleGroupItem>
                <ToggleGroupItem value="both" className="h-7 px-2 text-xs" aria-label="View both time zones">
                  Both
                </ToggleGroupItem>
              </ToggleGroup>
              <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                <SelectTrigger className="h-8 flex-1 min-w-[140px] md:flex-none md:w-[160px] text-xs">
                  <SelectValue placeholder="Filter by owner" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All owners</SelectItem>
                  {owners.map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isAdmin && status?.connected && (
                <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
                  <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", syncing && "animate-spin")} />
                  {syncing ? "Syncing…" : "Sync"}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => { setAddDate(new Date()); setAddOpen(true); }}>
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Add event
              </Button>
              {isAdmin && (
                <Button size="sm" onClick={connect}>
                  {status?.connected ? "Reconnect" : "Connect Duncan calendar"}
                </Button>
              )}
            </div>
          </div>
        </Card>

        <Card className="p-3 flex-1 min-h-0 flex flex-col">
          {loading ? (
            <p className="text-sm text-muted-foreground p-8 text-center">Loading…</p>
          ) : (
            <div className="flex-1 min-h-[420px]">
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
                messages={{ agenda: "Events" }}
                components={{ toolbar: PlannerToolbar, event: EventChip as any }}
                popup
                selectable={isAdmin}
                onSelectSlot={(slot: any) => {
                  if (!isAdmin) return;
                  setAddDate(slot.start instanceof Date ? slot.start : new Date(slot.start));
                  setAddOpen(true);
                }}
                eventPropGetter={eventPropGetter as any}
                onSelectEvent={handleSelectItem as any}
                tooltipAccessor={(item: any) => {
                  if (item.resource?.kind === "goal") return `Goal target: ${item.resource.data.name}`;
                  const ev = item.resource?.data as KeyEvent;
                  const uk = formatTimeInTz(ev.start_at, "Europe/London");
                  const ind = formatTimeInTz(ev.start_at, "Asia/Kolkata");
                  const times = ev.all_day ? "All day" : `UK ${uk} · IN ${ind}`;
                  return `${ev.event_name || ev.title} · ${times}${ev.owner ? ` · ${ev.owner}` : ""}`;
                }}
              />
            </div>
          )}
        </Card>

        <DetailDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          event={selectedEvent}
          cards={cards}
          isAdmin={isAdmin}
          onChanged={refresh}
          viewTz={viewTz}
        />

        <AddEventDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          defaultDate={addDate}
          onCreated={refresh}
        />
      </div>
    </AppLayout>
  );
}
