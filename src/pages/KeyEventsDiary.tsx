import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Calendar as RBCalendar, dateFnsLocalizer, View } from "react-big-calendar";
import { format, parse, startOfWeek as dateFnsStartOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";

const startOfWeek = (date: Date) => dateFnsStartOfWeek(date, { weekStartsOn: 1 });
import "react-big-calendar/lib/css/react-big-calendar.css";
import "@/components/diary/calendar.css";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useKeyEvents, type KeyEvent } from "@/hooks/useKeyEvents";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import {
  RefreshCw,
  Plus,
  ChevronLeft,
  ChevronRight,
  Settings2,
  PlayCircle,
  CalendarDays,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { DetailDrawer } from "@/components/diary/DetailDrawer";
import { AddEventDialog } from "@/components/diary/AddEventDialog";
import { PlannerAsk } from "@/components/diary/PlannerAsk";
import { useTour } from "@/components/onboarding/tour/TourProvider";
import { formatTimeInTz } from "@/components/diary/TimezonePicker";
import { CATEGORY_META, CATEGORY_GROUPS, getCategoryMeta } from "@/components/diary/categoryMeta";

const VIEW_TZ = "Europe/London";

const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales });

type CalItem = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  resource: { kind: "event"; data: KeyEvent };
};

function startOfDayLocal(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDaysLocal(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function eventTime(ev: KeyEvent) {
  if (ev.all_day) return "All day";
  return formatTimeInTz(ev.start_at, VIEW_TZ);
}

function eventName(ev: KeyEvent) {
  return ev.event_name || ev.title;
}

/** Minimal calendar toolbar — navigation only. */
function PlannerToolbar(props: any) {
  const { label, onNavigate, onView, view, views } = props;
  return (
    <div className="rbc-toolbar">
      <div className="planner-toolbar-nav flex items-center gap-1 min-w-0">
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => onNavigate("PREV")} aria-label="Previous">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="rbc-toolbar-label px-1 sm:px-2 w-[8.75rem] sm:w-auto sm:min-w-[140px] text-center truncate">{label}</span>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => onNavigate("NEXT")} aria-label="Next">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 ml-1 text-xs shrink-0" onClick={() => onNavigate("TODAY")}>
          Today
        </Button>
      </div>
      <div className="planner-toolbar-views flex items-center gap-1 flex-wrap">
        {(views as string[]).map((v) => (
          <Button
            key={v}
            variant="ghost"
            size="sm"
            className={cn("h-7 text-xs capitalize px-2", view === v && "bg-accent text-foreground")}
            onClick={() => onView(v)}
          >
            {v}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** A single, quiet event row. */
function EventRow({
  ev,
  onOpen,
  showDate,
  note,
}: {
  ev: KeyEvent;
  onOpen: (ev: KeyEvent) => void;
  showDate?: boolean;
  note?: string;
}) {
  const meta = getCategoryMeta(ev.category);
  return (
    <button
      type="button"
      onClick={() => onOpen(ev)}
      className="group flex w-full items-baseline gap-4 rounded-lg px-3 py-3 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className="w-[104px] shrink-0 text-xs tabular-nums text-muted-foreground">
        {showDate && ev.start_at ? `${format(new Date(ev.start_at), "EEE d MMM")} · ` : ""}
        {eventTime(ev)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {eventName(ev)}
        </span>
        {(note || ev.owner) && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{note || ev.owner}</span>
        )}
      </span>
      <span
        aria-hidden
        className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full opacity-60"
        style={{ background: `hsl(${meta.hsl})` }}
      />
    </button>
  );
}

function Section({
  title,
  action,
  children,
  dataTour,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  dataTour?: string;
}) {
  return (
    <section data-tour={dataTour} className="space-y-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{title}</h2>
        {action}
      </div>
      <div className="rounded-2xl border border-border/60 bg-card p-1.5">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export default function KeyEventsDiary() {
  const { events, cards, status, lastSync, loading, syncing, refresh, connect, sync } = useKeyEvents();
  const { isAdmin } = useIsAdmin();
  const isMobile = useIsMobile();
  const { start: startTour, progress } = useTour();
  const [params, setParams] = useSearchParams();

  const [view, setView] = useState<View>("month");
  const [date, setDate] = useState<Date>(new Date());
  const [calendarOpen, setCalendarOpen] = useState(!isMobile);
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedEvent, setSelectedEvent] = useState<KeyEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState<Date | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const tourState = progress["planner"];
  const tourLabel =
    tourState?.status === "completed" || tourState?.status === "skipped"
      ? "Replay tour"
      : tourState?.status === "in_progress"
      ? "Resume tour"
      : "Start tour";

  useEffect(() => {
    const flag = params.get("duncan_calendar");
    if (!flag) return;
    if (flag === "connected") toast.success("Calendar connected");
    else if (flag === "connected_no_calendar") toast.warning("Connected, but the Duncan | Planner calendar wasn't found in this account");
    else toast.error(`Calendar connection failed: ${params.get("reason") || "unknown"}`);
    params.delete("duncan_calendar");
    params.delete("reason");
    setParams(params, { replace: true });
  }, [params, setParams]);

  // Deep-link: /diary?event=<id>
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

  useEffect(() => {
    if (!selectedEvent) return;
    const latest = events.find((e) => e.id === selectedEvent.id);
    if (latest) {
      setSelectedEvent(latest);
      return;
    }
    setDrawerOpen(false);
    setSelectedEvent(null);
  }, [events, selectedEvent]);

  const owners = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => { if (e.owner) set.add(e.owner); });
    return Array.from(set).sort();
  }, [events]);

  const visibleEvents = useMemo(() => {
    const isHoliday = (e: KeyEvent) => e.category === "PublicHoliday";
    let list = events.filter((e) => e.start_at);
    if (ownerFilter !== "all") list = list.filter((e) => isHoliday(e) || (e.owner || "") === ownerFilter);
    if (selectedCategories.size > 0) {
      list = list.filter((e) => isHoliday(e) || (e.category && selectedCategories.has(e.category)));
    }
    return list;
  }, [events, ownerFilter, selectedCategories]);

  const todayEvents = useMemo(() => {
    const dayStart = startOfDayLocal(new Date());
    const dayEnd = addDaysLocal(dayStart, 1);
    return visibleEvents
      .filter((e) => {
        const s = new Date(e.start_at!);
        const en = e.end_at ? new Date(e.end_at) : s;
        return s < dayEnd && en >= dayStart;
      })
      .sort((a, b) => new Date(a.start_at!).getTime() - new Date(b.start_at!).getTime());
  }, [visibleEvents]);

  const upcomingEvents = useMemo(() => {
    const from = addDaysLocal(startOfDayLocal(new Date()), 1);
    const to = addDaysLocal(from, 21);
    return visibleEvents
      .filter((e) => {
        const s = new Date(e.start_at!);
        return s >= from && s < to;
      })
      .sort((a, b) => new Date(a.start_at!).getTime() - new Date(b.start_at!).getTime())
      .slice(0, 6);
  }, [visibleEvents]);

  /** Things Duncan thinks need a human: awaiting approval, off-track, or overlapping. */
  const attention = useMemo(() => {
    const now = new Date();
    const horizon = addDaysLocal(now, 14);
    const window = visibleEvents
      .filter((e) => e.category !== "PublicHoliday")
      .filter((e) => {
        const s = new Date(e.start_at!);
        return s >= startOfDayLocal(now) && s < horizon;
      })
      .sort((a, b) => new Date(a.start_at!).getTime() - new Date(b.start_at!).getTime());

    const items: { ev: KeyEvent; note: string }[] = [];
    const seen = new Set<string>();
    const add = (ev: KeyEvent, note: string) => {
      if (seen.has(ev.id)) return;
      seen.add(ev.id);
      items.push({ ev, note });
    };

    // Overlaps
    for (let i = 0; i < window.length; i++) {
      for (let j = i + 1; j < window.length; j++) {
        const a = window[i];
        const b = window[j];
        if (a.all_day || b.all_day) continue;
        const aS = new Date(a.start_at!).getTime();
        const aE = a.end_at ? new Date(a.end_at).getTime() : aS + 3600000;
        const bS = new Date(b.start_at!).getTime();
        if (bS >= aE) break;
        const bE = b.end_at ? new Date(b.end_at).getTime() : bS + 3600000;
        if (bS < aE && aS < bE) {
          add(a, `Overlaps with ${eventName(b)}`);
          add(b, `Overlaps with ${eventName(a)}`);
        }
      }
    }

    window.forEach((e) => {
      if (e.approval_state === "pending") add(e, "Waiting for approval");
      else if (e.risk_level === "red") add(e, e.risk_reason || "Off track");
      else if (e.risk_level === "amber") add(e, e.risk_reason || "At risk");
    });

    return items.slice(0, 5);
  }, [visibleEvents]);

  const calItems = useMemo<CalItem[]>(
    () =>
      visibleEvents.map((e) => {
        const start = new Date(e.start_at!);
        const end = e.end_at ? new Date(e.end_at) : new Date(start.getTime() + 60 * 60 * 1000);
        return {
          id: `event:${e.id}`,
          title: eventName(e),
          start,
          end,
          allDay: e.all_day,
          resource: { kind: "event" as const, data: e },
        };
      }),
    [visibleEvents],
  );

  const openEvent = (ev: KeyEvent) => {
    setSelectedEvent(ev);
    setDrawerOpen(true);
  };

  const eventPropGetter = (item: CalItem) => {
    const ev = item.resource.data;
    const meta = getCategoryMeta(ev.category);
    return {
      className: "evt-quiet",
      style: { ["--cat-color" as any]: meta.hsl } as React.CSSProperties,
    };
  };

  const EventChip = ({ event }: { event: CalItem }) => {
    const ev = event.resource.data;
    const meta = getCategoryMeta(ev.category);
    return (
      <div className="flex min-w-0 items-center gap-1.5 leading-tight">
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: `hsl(${meta.hsl})` }} />
        <span className="truncate">{eventName(ev)}</span>
        {!ev.all_day && <span className="shrink-0 text-[10px] opacity-70">{formatTimeInTz(ev.start_at, VIEW_TZ)}</span>}
      </div>
    );
  };

  const toggleCategory = (key: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-20 pt-6 sm:px-6 md:pt-10">
      {/* Quiet header: brand line + secondary actions */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Planner</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => startTour("planner", { restart: tourState?.status === "completed" || tourState?.status === "skipped" })}
          >
            <PlayCircle className="h-3.5 w-3.5" /> {tourLabel}
          </Button>
          <Sheet open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <SheetTrigger asChild>
              <Button
                data-tour="planner-advanced"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <Settings2 className="h-3.5 w-3.5" /> Settings
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
              <SheetHeader>
                <SheetTitle>Planner settings</SheetTitle>
                <SheetDescription>Connection, syncing and filters. You rarely need these.</SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <div className="rounded-xl border border-border/60 p-4">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", status?.connected ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                    <span className="text-sm font-medium">
                      {status?.connected ? `Connected as ${status.google_account_email || "Duncan"}` : "Not connected"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {status?.calendar_id
                      ? `Calendar: ${status.calendar_name}`
                      : status?.connected
                      ? "The 'Duncan | Planner' calendar wasn't found in this account."
                      : "An admin needs to connect Duncan's Google account."}
                  </p>
                  {lastSync && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Last sync: {fmtDateTime(lastSync.finished_at || lastSync.started_at)} ({lastSync.status})
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {isAdmin && status?.connected && (
                      <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
                        <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", syncing && "animate-spin")} />
                        {syncing ? "Syncing…" : "Sync now"}
                      </Button>
                    )}
                    {isAdmin && (
                      <Button variant="outline" size="sm" onClick={connect}>
                        {status?.connected ? "Reconnect" : "Connect calendar"}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Owner</h3>
                  <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="All owners" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All owners</SelectItem>
                      {owners.map((o) => (
                        <SelectItem key={o} value={o}>{o}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Categories</h3>
                    {selectedCategories.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedCategories(new Set())}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Show all
                      </button>
                    )}
                  </div>
                  <div className="space-y-3">
                    {CATEGORY_GROUPS.map((group) => (
                      <div key={group.label}>
                        <div className="mb-1.5 text-[11px] text-muted-foreground">{group.label}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {group.keys.map((key) => {
                            const meta = CATEGORY_META[key];
                            if (!meta) return null;
                            const active = selectedCategories.has(key);
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() => toggleCategory(key)}
                                className={cn(
                                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                                  active
                                    ? "border-primary/50 bg-primary/10 text-foreground"
                                    : "border-border/60 text-muted-foreground hover:bg-accent/40",
                                )}
                              >
                                {meta.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* 1 — Duncan */}
      <div data-tour="planner-ask">
        <PlannerAsk onChanged={refresh} />
      </div>

      <div className="mt-10 space-y-10">
        {/* 2 — Needs attention */}
        {attention.length > 0 && (
          <Section title="Needs your attention">
            <div className="divide-y divide-border/50">
              {attention.map(({ ev, note }) => (
                <EventRow key={`att-${ev.id}`} ev={ev} onOpen={openEvent} showDate note={note} />
              ))}
            </div>
          </Section>
        )}

        {/* 3 — Today */}
        <Section
          title="Today"
          dataTour="planner-plan"
          action={
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => { setAddDate(new Date()); setAddOpen(true); }}
            >
              <Plus className="h-3.5 w-3.5" /> Add manually
            </Button>
          }
        >
          {loading ? (
            <Empty>Loading your plan…</Empty>
          ) : todayEvents.length === 0 ? (
            <Empty>Nothing scheduled today.</Empty>
          ) : (
            <div className="divide-y divide-border/50">
              {todayEvents.map((ev) => (
                <EventRow key={ev.id} ev={ev} onOpen={openEvent} />
              ))}
            </div>
          )}
        </Section>

        {/* 4 — Upcoming */}
        <Section title="Coming up">
          {loading ? (
            <Empty>Loading…</Empty>
          ) : upcomingEvents.length === 0 ? (
            <Empty>Nothing in the next three weeks.</Empty>
          ) : (
            <div className="divide-y divide-border/50">
              {upcomingEvents.map((ev) => (
                <EventRow key={ev.id} ev={ev} onOpen={openEvent} showDate />
              ))}
            </div>
          )}
        </Section>

        {/* 5 — Calendar */}
        <section data-tour="planner-calendar" className="space-y-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Calendar</h2>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setCalendarOpen((o) => !o)}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              {calendarOpen ? "Hide" : "Show"}
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", calendarOpen && "rotate-180")} />
            </Button>
          </div>
          {calendarOpen && (
            <div className="rounded-2xl border border-border/60 bg-card p-2 sm:p-3">
              <div className="h-[620px] min-w-0">
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
                  views={isMobile ? ["agenda", "day"] : ["month", "week", "agenda"]}
                  messages={{ agenda: "List" }}
                  components={{ toolbar: PlannerToolbar, event: EventChip as any }}
                  popup
                  selectable={isAdmin}
                  onSelectSlot={(slot: any) => {
                    if (!isAdmin) return;
                    setAddDate(slot.start instanceof Date ? slot.start : new Date(slot.start));
                    setAddOpen(true);
                  }}
                  eventPropGetter={eventPropGetter as any}
                  onSelectEvent={(item: any) => openEvent(item.resource.data)}
                  tooltipAccessor={(item: any) => {
                    const ev = item.resource?.data as KeyEvent;
                    return `${eventName(ev)} · ${eventTime(ev)}${ev.owner ? ` · ${ev.owner}` : ""}`;
                  }}
                />
              </div>
            </div>
          )}
        </section>
      </div>

      <DetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        event={selectedEvent}
        cards={cards}
        isAdmin={isAdmin}
        onChanged={refresh}
        viewTz={VIEW_TZ as any}
      />

      <AddEventDialog open={addOpen} onOpenChange={setAddOpen} defaultDate={addDate} onCreated={refresh} />
    </div>
  );
}
