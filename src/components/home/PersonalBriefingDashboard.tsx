import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar as CalendarIcon,
  ListChecks,
  AlertCircle,
  Activity,
  Trophy,
  Sparkles,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

import { useMyPendingTasks } from "@/hooks/useHomeDashboard";
import { useGoogleCalendar, type CalendarEvent } from "@/hooks/useGoogleCalendar";
import { LeaderboardSection } from "@/components/home/LeaderboardTile";

/* ---------- helpers ---------- */
const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};
const fmt = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n));
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const startOfWeek = () => {
  const d = startOfDay();
  const diff = (d.getDay() + 6) % 7; // Monday start
  d.setDate(d.getDate() - diff);
  return d;
};
const endOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

/* ---------- shell ---------- */
const Tile = ({ children, className = "", delay = 0 }: any) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.35 }}
    className={`rounded-xl border border-border bg-card p-4 sm:p-5 ${className}`}
  >
    {children}
  </motion.div>
);

const TileHeader = ({ icon: Icon, label, action }: any) => (
  <div className="flex items-center justify-between mb-3">
    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
      <Icon className="h-3 w-3" />
      {label}
    </div>
    {action}
  </div>
);

/* ---------- data hooks ---------- */
function useTodayMeetings() {
  const { isConnected, checkConnection, listEvents } = useGoogleCalendar();
  useEffect(() => { checkConnection(); /* eslint-disable-next-line */ }, []);
  return useQuery<{ connected: boolean; events: CalendarEvent[] }>({
    queryKey: ["home-briefing", "meetings-today-upcoming"],
    enabled: isConnected === true,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const timeMin = startOfDay().toISOString();
      const timeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      try {
        const events = await listEvents({ timeMin, timeMax, maxResults: 25 });
        return { connected: true, events };
      } catch {
        return { connected: false, events: [] };
      }
    },
  });
}

type ProjectTask = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  project_id: string;
  project_name: string;
};

function useMyProjectTasks() {
  const { user } = useAuth();
  return useQuery<ProjectTask[]>({
    queryKey: ["home-briefing", "my-project-tasks", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const ids = [user!.id];
      const { data: prof } = await supabase.from("profiles").select("id").eq("user_id", user!.id).maybeSingle();
      if (prof?.id) ids.push(prof.id);
      const { data, error } = await supabase
        .from("project_chat_plan_items")
        .select("id,title,status,due_date,project_id,projects(name)")
        .in("assignee_profile_id", ids)
        .neq("status", "done");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        due_date: r.due_date,
        project_id: r.project_id,
        project_name: r.projects?.name ?? "Project",
      }));
    },
  });
}

function useWeeklyUsage() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["home-briefing", "weekly-usage", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const weekStart = startOfWeek().toISOString().slice(0, 10);
      const [usageRes, wsDoneRes, projDoneRes, meetingsRes] = await Promise.all([
        supabase.from("token_usage").select("total_tokens,request_count,category_counts,usage_date").eq("user_id", user!.id).gte("usage_date", weekStart),
        supabase.from("workstream_tasks").select("id", { count: "exact", head: true }).eq("assignee_id", user!.id).eq("completed", true).gte("updated_at", startOfWeek().toISOString()),
        supabase.from("project_chat_plan_items").select("id", { count: "exact", head: true }).eq("assignee_profile_id", user!.id).eq("status", "done").gte("updated_at", startOfWeek().toISOString()),
        supabase.from("meetings").select("id", { count: "exact", head: true }).gte("created_at", startOfWeek().toISOString()),
      ]);
      const rows = (usageRes.data ?? []) as any[];
      const tokens = rows.reduce((s, r) => s + Number(r.total_tokens ?? 0), 0);
      const requests = rows.reduce((s, r) => s + Number(r.request_count ?? 0), 0);
      // rough hours-saved estimate matching leaderboard weighting (avg 8m per request)
      const hoursSaved = (requests * 8) / 60;
      return {
        tokens,
        requests,
        hoursSaved,
        tasksCompleted: (wsDoneRes.count ?? 0) + (projDoneRes.count ?? 0),
        meetingsAttended: meetingsRes.count ?? 0,
      };
    },
  });
}

/* ---------- section: meetings ---------- */
function MeetingsSection() {
  const { isConnected } = useGoogleCalendar();
  const { data, isLoading } = useTodayMeetings();
  const navigate = useNavigate();

  const { today, upcoming } = useMemo(() => {
    const evs = data?.events ?? [];
    const eod = endOfDay();
    const t: CalendarEvent[] = [];
    const u: CalendarEvent[] = [];
    for (const e of evs) {
      const startIso = e.start?.dateTime || e.start?.date;
      if (!startIso) continue;
      const start = new Date(startIso);
      if (start <= eod) t.push(e); else u.push(e);
    }
    return { today: t.slice(0, 6), upcoming: u.slice(0, 6) };
  }, [data]);

  return (
    <Tile delay={0.05}>
      <TileHeader
        icon={CalendarIcon}
        label="Meetings"
        action={
          <button onClick={() => navigate("/diary")} className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5">
            Open <ExternalLink className="h-2.5 w-2.5" />
          </button>
        }
      />
      {isConnected === false ? (
        <p className="text-xs text-muted-foreground">
          Google Calendar isn't connected.{" "}
          <button onClick={() => navigate("/integrations")} className="text-primary hover:underline">Connect it</button>{" "}
          to see your day.
        </p>
      ) : isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : today.length === 0 && upcoming.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing on the calendar for the week ahead.</p>
      ) : (
        <div className="space-y-3">
          <MeetingList label="Today" events={today} emptyLabel="No meetings today." />
          <MeetingList label="Next 7 days" events={upcoming} emptyLabel="No upcoming meetings." />
        </div>
      )}
    </Tile>
  );
}

function MeetingList({ label, events, emptyLabel }: { label: string; events: CalendarEvent[]; emptyLabel: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">{label}</div>
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-border/40">
          {events.map((e) => {
            const startIso = e.start?.dateTime || e.start?.date;
            const endIso = e.end?.dateTime || e.end?.date;
            const start = startIso ? new Date(startIso) : null;
            const end = endIso ? new Date(endIso) : null;
            const owner = e.attendees?.find((a: any) => a.organizer)?.email
              ?? e.attendees?.[0]?.email
              ?? "";
            return (
              <li key={e.id} className="py-2 flex items-start gap-3">
                <div className="text-[11px] tabular-nums text-muted-foreground w-24 shrink-0">
                  {start ? start.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}<br />
                  {start ? start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                  {end ? `–${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-foreground truncate">{e.summary || "Untitled meeting"}</div>
                  {owner && <div className="text-[10px] text-muted-foreground truncate">{owner}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------- section: tasks ---------- */
type UnifiedTask = {
  id: string;
  title: string;
  source: "Workstream" | "Project";
  context: string;
  status: string;
  due_date: string | null;
  href: string;
};

function useUnifiedTasks() {
  const ws = useMyPendingTasks();
  const proj = useMyProjectTasks();
  const tasks: UnifiedTask[] = useMemo(() => {
    const a: UnifiedTask[] = (ws.data ?? []).map((t) => ({
      id: `ws-${t.id}`,
      title: t.title,
      source: "Workstream",
      context: t.card_title,
      status: t.status,
      due_date: t.due_date,
      href: `/workstreams?card=${t.card_id}`,
    }));
    const b: UnifiedTask[] = (proj.data ?? []).map((t) => ({
      id: `pj-${t.id}`,
      title: t.title,
      source: "Project",
      context: t.project_name,
      status: t.status,
      due_date: t.due_date,
      href: `/projects/${t.project_id}`,
    }));
    return [...a, ...b];
  }, [ws.data, proj.data]);
  return { tasks, isLoading: ws.isLoading || proj.isLoading };
}

function bucketTasks(tasks: UnifiedTask[]) {
  const today = startOfDay();
  const eod = endOfDay();
  const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
  const overdue: UnifiedTask[] = [];
  const dueToday: UnifiedTask[] = [];
  const upcoming: UnifiedTask[] = [];
  const later: UnifiedTask[] = [];
  for (const t of tasks) {
    if (!t.due_date) { later.push(t); continue; }
    const d = new Date(t.due_date + "T00:00:00");
    if (d < today) overdue.push(t);
    else if (d <= eod) dueToday.push(t);
    else if (d <= in7) upcoming.push(t);
    else later.push(t);
  }
  const byDate = (a: UnifiedTask, b: UnifiedTask) => (a.due_date || "").localeCompare(b.due_date || "");
  return { overdue: overdue.sort(byDate), dueToday: dueToday.sort(byDate), upcoming: upcoming.sort(byDate), later };
}

function TaskRow({ t, tone }: { t: UnifiedTask; tone?: "overdue" | "today" | "upcoming" }) {
  const navigate = useNavigate();
  const due = t.due_date ? new Date(t.due_date + "T00:00:00") : null;
  const dueLabel = due ? due.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "No date";
  const dueClass =
    tone === "overdue" ? "text-destructive font-semibold" :
    tone === "today" ? "text-amber-600 dark:text-amber-400 font-medium" :
    "text-muted-foreground";
  return (
    <button
      onClick={() => navigate(t.href)}
      className="w-full text-left flex items-center gap-3 py-2 hover:bg-muted/30 rounded-md px-1 -mx-1 transition-colors"
    >
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-foreground truncate">{t.title}</div>
        <div className="text-[10px] text-muted-foreground truncate">
          <span className="uppercase tracking-widest mr-1">{t.source}</span>· {t.context}
        </div>
      </div>
      <div className={`text-[10px] tabular-nums shrink-0 ${dueClass}`}>{dueLabel}</div>
    </button>
  );
}

function AssignedTasksSection() {
  const { tasks, isLoading } = useUnifiedTasks();
  const b = useMemo(() => bucketTasks(tasks), [tasks]);
  const total = tasks.length;

  return (
    <Tile delay={0.08}>
      <TileHeader icon={ListChecks} label={`Assigned tasks${total ? ` · ${total}` : ""}`} />
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : total === 0 ? (
        <p className="text-xs text-muted-foreground">You're all clear. No open tasks assigned to you.</p>
      ) : (
        <div className="space-y-4">
          {b.overdue.length > 0 && <TaskGroup title={`Overdue · ${b.overdue.length}`} rows={b.overdue.slice(0, 6)} tone="overdue" />}
          {b.dueToday.length > 0 && <TaskGroup title={`Due today · ${b.dueToday.length}`} rows={b.dueToday.slice(0, 6)} tone="today" />}
          {b.upcoming.length > 0 && <TaskGroup title={`Next 7 days · ${b.upcoming.length}`} rows={b.upcoming.slice(0, 6)} tone="upcoming" />}
          {b.later.length > 0 && <TaskGroup title={`No due date · ${b.later.length}`} rows={b.later.slice(0, 4)} />}
        </div>
      )}
    </Tile>
  );
}

function TaskGroup({ title, rows, tone }: { title: string; rows: UnifiedTask[]; tone?: "overdue" | "today" | "upcoming" }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">{title}</div>
      <div className="divide-y divide-border/40">
        {rows.map((t) => <TaskRow key={t.id} t={t} tone={tone} />)}
      </div>
    </div>
  );
}

/* ---------- section: action items ---------- */
function ActionItemsSection() {
  const { tasks } = useUnifiedTasks();
  const b = useMemo(() => bucketTasks(tasks), [tasks]);
  const items = [...b.overdue, ...b.dueToday, ...b.upcoming].slice(0, 6);
  return (
    <Tile delay={0.1}>
      <TileHeader icon={AlertCircle} label="Action items · needs attention" />
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing needs your attention right now.</p>
      ) : (
        <div className="divide-y divide-border/40">
          {items.map((t) => {
            const due = t.due_date ? new Date(t.due_date + "T00:00:00") : null;
            const today = startOfDay();
            const eod = endOfDay();
            const tone: "overdue" | "today" | "upcoming" =
              due && due < today ? "overdue" : due && due <= eod ? "today" : "upcoming";
            return <TaskRow key={t.id} t={t} tone={tone} />;
          })}
        </div>
      )}
    </Tile>
  );
}

/* ---------- section: weekly usage ---------- */
function WeeklyUsageSection() {
  const { data, isLoading } = useWeeklyUsage();
  const items = [
    { label: "Tokens used", value: data ? fmt(data.tokens) : "—" },
    { label: "Hours saved", value: data ? data.hoursSaved.toFixed(data.hoursSaved >= 10 ? 1 : 2) : "—" },
    { label: "Tasks completed", value: data ? fmt(data.tasksCompleted) : "—" },
    { label: "Meetings ingested", value: data ? fmt(data.meetingsAttended) : "—" },
  ];
  return (
    <Tile delay={0.12}>
      <TileHeader icon={Activity} label="This week · your activity" />
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {items.map((m) => (
            <div key={m.label}>
              <div className="text-xl sm:text-2xl font-bold text-foreground tracking-tight tabular-nums">{m.value}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{m.label}</div>
            </div>
          ))}
        </div>
      )}
      <div className="text-[10px] text-muted-foreground/70 mt-3">
        Rolling since Monday. Hours saved is a rough estimate (~8 min per Duncan request).
      </div>
    </Tile>
  );
}

/* ---------- top hero ---------- */
function PersonalBriefingHero({ firstName }: { firstName: string }) {
  const { tasks } = useUnifiedTasks();
  const { data: meetings } = useTodayMeetings();
  const b = useMemo(() => bucketTasks(tasks), [tasks]);
  const eod = endOfDay();
  const meetingsToday = (meetings?.events ?? []).filter((e) => {
    const s = e.start?.dateTime || e.start?.date;
    return s && new Date(s) <= eod;
  }).length;
  const upcomingWeek = b.upcoming.length;
  const openTotal = tasks.length;
  const overdue = b.overdue.length;

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <Tile className="relative overflow-hidden">
      <div className="absolute inset-0 gradient-radial opacity-40 pointer-events-none" />
      <div className="relative z-10">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Sparkles className="h-3 w-3" /> Daily Briefing · {today}
        </div>
        <h1 className="mt-1 text-2xl sm:text-3xl font-semibold text-foreground tracking-tight">
          {getGreeting()}, {firstName}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Here's what's on your plate today.</p>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <HeroStat value={meetingsToday} label="meetings today" />
          <HeroStat value={openTotal} label="open tasks" />
          <HeroStat value={overdue} label="overdue" tone={overdue > 0 ? "danger" : undefined} />
          <HeroStat value={upcomingWeek} label="due this week" />
        </div>
      </div>
    </Tile>
  );
}

function HeroStat({ value, label, tone }: { value: number; label: string; tone?: "danger" }) {
  return (
    <div>
      <div className={`text-2xl sm:text-3xl font-bold tracking-tight tabular-nums ${tone === "danger" && value > 0 ? "text-destructive" : "text-foreground"}`}>
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

/* ---------- top-level ---------- */
export const PersonalBriefingDashboard = ({ userName }: { userName: string }) => {
  const firstName = (userName || "").split(" ")[0] || "there";
  return (
    <div className="mx-auto w-full max-w-6xl space-y-3 sm:space-y-4">
      <PersonalBriefingHero firstName={firstName} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
        <MeetingsSection />
        <AssignedTasksSection />
      </div>
      <ActionItemsSection />
      <WeeklyUsageSection />
      <div>
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2 px-1">
          <Trophy className="h-3 w-3" /> Team leaderboard
        </div>
        <LeaderboardSection />
      </div>
    </div>
  );
};

export default PersonalBriefingDashboard;
