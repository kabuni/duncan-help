import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, Loader2, Search, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { useSettingsPanel } from "@/hooks/SettingsPanelContext";
import { toast } from "sonner";
import { format } from "date-fns";

type FeatureRequest = {
  id: string;
  title: string;
  refined_title: string | null;
  description: string;
  problem_statement: string | null;
  status: string;
  priority_band: string | null;
  category: string | null;
  user_email: string | null;
  created_at: string;
};

const NEUTRAL = "bg-muted text-muted-foreground border-border";
const RED = "bg-destructive/10 text-destructive border-destructive/20";
const AMBER = "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
const GREEN = "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
const BLUE = "bg-primary/10 text-primary border-primary/20";

const STATUS: Record<string, { label: string; className: string }> = {
  new: { label: "New", className: NEUTRAL },
  under_review: { label: "Under Review", className: AMBER },
  planned: { label: "Planned", className: BLUE },
  in_progress: { label: "In Development", className: BLUE },
  testing: { label: "Testing", className: AMBER },
  completed: { label: "Released", className: GREEN },
  released: { label: "Released", className: GREEN },
  declined: { label: "Rejected", className: RED },
  rejected: { label: "Rejected", className: RED },
};

const STATUS_OPTIONS = ["new", "under_review", "planned", "in_progress", "completed", "declined"];
const DONE = ["completed", "released"];

const Badge = ({ className, children }: { className: string; children: React.ReactNode }) => (
  <span className={`text-[10px] px-1.5 py-0.5 rounded-md border font-medium whitespace-nowrap ${className}`}>
    {children}
  </span>
);

const shortId = (id: string) => `FR-${id.replace(/-/g, "").slice(0, 4).toUpperCase()}`;

const Stat = ({ label, value, className }: { label: string; value: number | string; className?: string }) => (
  <div className="rounded-xl border border-border bg-card px-4 py-3">
    <div className={`text-3xl font-bold tracking-tight tabular-nums ${className ?? "text-foreground"}`}>{value}</div>
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">{label}</div>
  </div>
);

export default function FeatureRequestsBoard() {
  const qc = useQueryClient();
  const { isAdmin } = useIsAdmin();
  const { openSettings } = useSettingsPanel();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "open" | "completed">("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["all-feature-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("feature_requests")
        .select("id, title, refined_title, description, problem_statement, status, priority_band, category, user_email, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as FeatureRequest[];
    },
  });

  const rows = data ?? [];
  const total = rows.length;
  const completed = rows.filter((r) => DONE.includes((r.status || "").toLowerCase())).length;
  const inFlight = total - completed;
  const rate = total ? Math.round((completed / total) * 100) : 0;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const done = DONE.includes((r.status || "").toLowerCase());
      if (filter === "open" && done) return false;
      if (filter === "completed" && !done) return false;
      if (!q) return true;
      return (
        (r.refined_title ?? r.title).toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q) ||
        (r.user_email || "").toLowerCase().includes(q) ||
        shortId(r.id).toLowerCase().includes(q)
      );
    });
  }, [rows, search, filter]);

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("feature_requests").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Status updated");
    qc.invalidateQueries({ queryKey: ["all-feature-requests"] });
    qc.invalidateQueries({ queryKey: ["home-latest-features"] });
  };

  return (
    <main className="flex-1 overflow-y-auto p-4 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-muted-foreground" /> Feature Requests
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Every requested feature and its current status.{!isAdmin && " View only — admins manage status."}
            </p>
          </div>
          <button
            onClick={() => openSettings("request_feature")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-secondary/60 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Request a feature
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Total requests" value={isLoading ? "…" : total} />
          <Stat label="Completed" value={isLoading ? "…" : completed} className="text-emerald-600 dark:text-emerald-400" />
          <Stat label="In flight" value={isLoading ? "…" : inFlight} className="text-primary" />
          <Stat label="Completion rate" value={isLoading ? "…" : `${rate}%`} />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search requests, requester or ID…"
              className="w-full rounded-md border border-border bg-card pl-8 pr-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-1">
            {(["all", "open", "completed"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md border px-3 py-1.5 text-xs capitalize transition-colors ${
                  filter === f ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <p className="text-sm text-muted-foreground">Unable to load feature requests.</p>
        ) : isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">No feature requests found.</p>
        ) : (
          <div className="rounded-xl border border-border bg-card divide-y divide-border/60">
            {visible.map((r) => {
              const s = STATUS[(r.status || "new").toLowerCase()] ?? { label: r.status || "New", className: NEUTRAL };
              return (
                <div key={r.id} className="p-4 space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0">{shortId(r.id)}</span>
                        <span className="text-sm font-medium text-foreground truncate">{r.refined_title ?? r.title}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {r.user_email ?? "Unknown"} · {format(new Date(r.created_at), "MMM d, yyyy")}
                        {r.category ? ` · ${r.category}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      {r.priority_band && <Badge className={NEUTRAL}>{r.priority_band}</Badge>}
                      <Badge className={s.className}>{s.label}</Badge>
                    </div>
                  </div>
                  <p className="text-xs text-foreground/80 whitespace-pre-wrap line-clamp-3">
                    {r.problem_statement ?? r.description}
                  </p>
                  {isAdmin && (
                    <div className="flex items-center gap-2 pt-1">
                      <label className="text-[11px] text-muted-foreground">Status:</label>
                      <select
                        value={r.status}
                        onChange={(e) => updateStatus(r.id, e.target.value)}
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o} value={o}>{o.replace("_", " ")}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
