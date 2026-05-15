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
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, Plus, ChevronLeft, ChevronRight, Mail } from "lucide-react";
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
      <div className="planner-toolbar-nav flex items-center gap-1 min-w-0">
        <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" onClick={() => onNavigate("PREV")} aria-label="Previous">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="rbc-toolbar-label px-1 sm:px-2 w-[8.75rem] sm:w-auto sm:min-w-[140px] text-center truncate">{label}</span>
        <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" onClick={() => onNavigate("NEXT")} aria-label="Next">
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
            variant={view === v ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs capitalize px-2"
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

function formatMobileTime(item: CalItem, viewTz: ViewTz) {
  const ev = item.resource.data;
  if (ev.all_day) return "All day";
  if (viewTz === "both") {
    return `UK ${formatTimeInTz(ev.start_at, "Europe/London")} · IN ${formatTimeInTz(ev.start_at, "Asia/Kolkata")}`;
  }
  return formatTimeInTz(ev.start_at, viewTz);
}

function MobileAgenda({
  items,
  date,
  onNavigate,
  onSelectItem,
  viewTz,
}: {
  items: CalItem[];
  date: Date;
  onNavigate: (date: Date) => void;
  onSelectItem: (item: CalItem) => void;
  viewTz: ViewTz;
}) {
  const rangeStart = startOfDayLocal(date);
  const rangeEnd = addDaysLocal(rangeStart, 30);
  const visibleItems = items
    .filter((item) => item.end >= rangeStart && item.start < rangeEnd)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const groupedItems = visibleItems.reduce<Record<string, CalItem[]>>((acc, item) => {
    const key = format(item.start, "yyyy-MM-dd");
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});

  return (
    <div className="flex h-full min-h-[58vh] flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => onNavigate(addDaysLocal(date, -30))} aria-label="Previous 30 days">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1 text-center">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Events</div>
          <div className="truncate text-sm font-semibold"><span className="sm:hidden">{format(rangeStart, "MMM d")} – {format(addDaysLocal(rangeStart, 29), "MMM d")}</span><span className="hidden sm:inline">{format(rangeStart, "MMM d")} – {format(addDaysLocal(rangeStart, 29), "MMM d, yyyy")}</span></div>
        </div>
        <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => onNavigate(addDaysLocal(date, 30))} aria-label="Next 30 days">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className="h-10 shrink-0 px-2 sm:px-3 text-xs sm:text-sm" onClick={() => onNavigate(new Date())}>
          Today
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto pt-3">
        {visibleItems.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No events in this window.</div>
        ) : (
          <div className="space-y-3">
            {Object.entries(groupedItems).map(([day, dayItems]) => (
              <section key={day} className="overflow-hidden rounded-md border border-border bg-card">
                <div className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-semibold text-muted-foreground">
                  {format(dayItems[0].start, "EEE MMM dd")}
                </div>
                <div className="divide-y divide-border">
                  {dayItems.map((item) => {
                    const ev = item.resource.data;
                    const meta = getCategoryMeta(ev.category);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelectItem(item)}
                        className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `hsl(${meta.hsl})` }} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold leading-snug text-foreground break-words">{meta.icon} {ev.event_name || ev.title}</span>
                          <span className="mt-1 block text-xs leading-snug text-muted-foreground break-words">{formatMobileTime(item, viewTz)}</span>
                          {ev.owner && <span className="mt-1 block text-xs leading-snug text-muted-foreground break-words">{ev.owner}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function KeyEventsDiary() {
  const { events, cards, status, lastSync, loading, syncing, refresh, connect, sync } = useKeyEvents();
  const { isAdmin } = useIsAdmin();
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>(() => (typeof window !== "undefined" && window.innerWidth < 768) ? "agenda" : "month");
  const [date, setDate] = useState<Date>(new Date());
  const [riskFilter, setRiskFilter] = useState<"all" | "atrisk">("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const toggleCategory = (key: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const [selectedEvent, setSelectedEvent] = useState<KeyEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState<Date | null>(null);
  const [scanningRsvps, setScanningRsvps] = useState(false);
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
    if (selectedCategories.size > 0) {
      filteredEvents = filteredEvents.filter((e) => e.category && selectedCategories.has(e.category));
    }

    const evItems: CalItem[] = filteredEvents
      .filter((e) => e.start_at)
      .map((e) => {
        const start = new Date(e.start_at!);
        const end = e.end_at ? new Date(e.end_at) : new Date(start.getTime() + 60 * 60 * 1000);
        const name = e.event_name || e.title;
        const meta = getCategoryMeta(e.category);
        const cat = e.category ? ` [${e.category}]` : "";
        const owner = e.owner ? ` · ${e.owner}` : "";
        const tz = e.start_tz && e.start_tz !== "Europe/London" ? ` · ${e.start_tz.split("/").pop()?.replace(/_/g, " ")}` : "";
        return {
          id: `event:${e.id}`,
          title: `${meta.icon} ${name}${cat}${owner}${tz}`,
          start,
          end,
          allDay: e.all_day,
          resource: { kind: "event", data: e },
        };
      });

    return evItems;
  }, [events, riskFilter, ownerFilter, selectedCategories]);


  function handleSelectItem(item: CalItem) {
    setSelectedEvent(item.resource.data);
    setDrawerOpen(true);
  }

  async function scanRsvps() {
    setScanningRsvps(true);
    try {
      const { data, error } = await supabase.functions.invoke("process-rsvp-emails");
      if (error) throw error;
      const summary = data as { scanned?: number; rsvps?: number; skipped?: number; errors?: string[] } | null;
      if (summary?.errors && summary.errors.length > 0) {
        toast.warning(`RSVP scan completed with ${summary.errors.length} error(s)`);
        console.warn("RSVP scan errors:", summary.errors);
      } else {
        toast.success(`RSVP scan complete — ${summary?.rsvps ?? 0} new, ${summary?.skipped ?? 0} skipped`);
      }
    } catch (err: any) {
      toast.error(err?.message || "RSVP scan failed");
    } finally {
      setScanningRsvps(false);
    }
  }

  const eventPropGetter = (item: CalItem) => {
    const ev = item.resource.data;
    const lvl = ev.risk_level;
    const meta = getCategoryMeta(ev.category);
    return {
      className: `evt-${lvl}`,
      style: { ["--cat-color" as any]: meta.hsl } as React.CSSProperties,
    };
  };

  const EventChip = ({ event }: { event: CalItem }) => {
    const ev = event.resource.data;
    const name = ev.event_name || ev.title;
    const isAllDay = ev.all_day;
    const meta = getCategoryMeta(ev.category);
    const Header = (
      <div className="flex items-center gap-1 min-w-0">
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
          style={{ background: `hsl(${meta.hsl})` }}
        />
        <span aria-hidden className="text-[10px] leading-none">{meta.icon}</span>
        <span className="truncate font-medium">{name}</span>
      </div>
    );
    if (viewTz === "both") {
      return (
        <div className="leading-tight">
          {Header}
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
        {Header}
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
      <div className="w-full max-w-[1400px] mx-auto px-3 sm:px-4 lg:px-8 py-3 md:py-6 flex flex-col gap-3 md:gap-4 h-[calc(100dvh-3.5rem)] md:h-[100dvh] min-h-0 overflow-y-auto overflow-x-hidden">
        <header className="space-y-1 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">Duncan Planner</h1>
            <Badge variant="outline" className="hidden sm:inline-flex font-mono text-[10px] uppercase">execution system</Badge>
          </div>
          <p className="text-xs md:text-sm text-muted-foreground break-words">
            Strategic events synced from <span className="font-semibold">Duncan | Planner</span>. Goal target dates appear as pinned markers.
          </p>
        </header>

        <Card className="p-3 shrink-0 overflow-hidden">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn("h-2 w-2 rounded-full shrink-0", status?.connected ? "bg-emerald-500" : "bg-muted-foreground/40")} />
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">
                  {status?.connected ? `Connected as ${status.google_account_email || "Duncan"}` : "Not connected"}
                </div>
                <div className="text-[11px] text-muted-foreground break-words [overflow-wrap:anywhere]">
                  {status?.calendar_id
                    ? <>Calendar: <span className="font-mono">{status.calendar_name}</span></>
                    : status?.connected
                      ? <span className="text-amber-500">'Duncan | Planner' calendar not found in this account.</span>
                      : "Admin must connect Duncan's Google account"}
                  {lastSync && <> · Last sync: {fmtDateTime(lastSync.finished_at || lastSync.started_at)} ({lastSync.status})</>}
                </div>
              </div>
            </div>
             <div className="flex items-stretch gap-2 flex-wrap w-full min-w-0 lg:w-auto lg:justify-end">
              <ToggleGroup
                type="single"
                size="sm"
                value={viewTz}
                onValueChange={(v) => v && setViewTz(v as ViewTz)}
                className="h-8 w-full min-w-0 sm:w-auto border border-border rounded-md p-0.5"
              >
                <ToggleGroupItem value="Europe/London" className="h-7 flex-1 sm:flex-none px-2 text-xs gap-1" aria-label="View in UK time">
                  <span aria-hidden>🇬🇧</span> UK
                </ToggleGroupItem>
                <ToggleGroupItem value="Asia/Kolkata" className="h-7 flex-1 sm:flex-none px-2 text-xs gap-1" aria-label="View in India time">
                  <span aria-hidden>🇮🇳</span> IN
                </ToggleGroupItem>
                <ToggleGroupItem value="both" className="h-7 flex-1 sm:flex-none px-2 text-xs" aria-label="View both time zones">
                  Both
                </ToggleGroupItem>
              </ToggleGroup>
              <div className="w-full sm:w-[160px]">
                <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue placeholder="Filter by owner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All owners</SelectItem>
                    {owners.map((o) => (
                      <SelectItem key={o} value={o}>{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isAdmin && status?.connected && (
                <Button className="flex-1 sm:flex-none whitespace-nowrap" variant="outline" size="sm" onClick={sync} disabled={syncing}>
                  <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", syncing && "animate-spin")} />
                  {syncing ? "Syncing…" : "Sync"}
                </Button>
              )}
              {isAdmin && (
                <Button
                  className="flex-1 sm:flex-none whitespace-nowrap"
                  variant="outline"
                  size="sm"
                  onClick={scanRsvps}
                  disabled={scanningRsvps}
                >
                  <Mail className={cn("h-3.5 w-3.5 mr-1.5", scanningRsvps && "animate-pulse")} />
                  {scanningRsvps ? "Scanning RSVPs…" : "Scan RSVPs"}
                </Button>
              )}
              <Button className="flex-1 sm:flex-none whitespace-nowrap" size="sm" variant="outline" onClick={() => { setAddDate(new Date()); setAddOpen(true); }}>
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Add event
              </Button>
              {isAdmin && (
                <Button className="flex-1 sm:flex-none whitespace-nowrap" size="sm" onClick={connect}>
                  {status?.connected ? "Reconnect" : "Connect Duncan calendar"}
                </Button>
              )}
            </div>
          </div>
        </Card>

        <div className="shrink-0 min-w-0 overflow-hidden lg:px-1">
          <div className="flex items-center gap-x-2 gap-y-1.5 text-[10px] sm:text-[11px] text-muted-foreground overflow-x-auto pb-1 whitespace-nowrap scrollbar-thin lg:flex-wrap lg:overflow-visible lg:pb-0 lg:whitespace-normal">
            <span className="font-mono uppercase tracking-wider text-[10px] shrink-0">Categories</span>
            {Object.entries(CATEGORY_META).map(([key, meta]) => {
              const active = selectedCategories.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleCategory(key)}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex items-center gap-1.5 shrink-0 rounded-full border px-2 py-0.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "border-transparent text-foreground font-medium shadow-sm"
                      : "border-border/60 hover:border-border hover:bg-accent/40",
                  )}
                  style={
                    active
                      ? {
                          background: `hsl(${meta.hsl} / 0.18)`,
                          boxShadow: `0 0 0 1px hsl(${meta.hsl} / 0.55), 0 0 8px hsl(${meta.hsl} / 0.25)`,
                        }
                      : undefined
                  }
                >
                  <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: `hsl(${meta.hsl})` }} />
                  <span aria-hidden>{meta.icon}</span>
                  <span>{meta.label}</span>
                </button>
              );
            })}
            {selectedCategories.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedCategories(new Set())}
                className="ml-1 shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wider hover:bg-accent"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <Card className="p-2 sm:p-3 shrink-0 min-w-0 flex flex-col overflow-visible">
          {loading ? (
            <p className="text-sm text-muted-foreground p-8 text-center">Loading…</p>
          ) : (
            <div className="min-h-[60vh] md:min-h-[78vh] min-w-0 overflow-visible">
              {isMobile ? (
                <MobileAgenda
                  items={calItems}
                  date={date}
                  onNavigate={setDate}
                  onSelectItem={handleSelectItem}
                  viewTz={viewTz}
                />
              ) : (
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
                    const ownerStr = ev.owner ? ` · ${ev.owner}` : "";
                    const collabs = (ev.collaborators || []).slice(0, 3)
                      .map((c) => `${c.display_name}${c.role ? ` (${c.role})` : ""}`)
                      .join(", ");
                    const more = (ev.collaborators?.length || 0) > 3 ? ` +${(ev.collaborators?.length || 0) - 3} more` : "";
                    const collabStr = collabs ? `\n+ ${ev.collaborators!.length} collaborator${ev.collaborators!.length === 1 ? "" : "s"}: ${collabs}${more}` : "";
                    return `${ev.event_name || ev.title} · ${times}${ownerStr}${collabStr}`;
                  }}
                />
              )}
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
