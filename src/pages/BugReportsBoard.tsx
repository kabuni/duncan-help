import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bug, Loader2, Search, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { toast } from "sonner";
import { format } from "date-fns";

type Issue = {
  id: string;
  title: string;
  description: string;
  issue_type: string | null;
  severity: string | null;
  affected_area: string | null;
  user_email: string | null;
  created_at: string;
  resolved_at: string | null;
};

const NEUTRAL = "bg-muted text-muted-foreground border-border";
const RED = "bg-destructive/10 text-destructive border-destructive/20";
const AMBER = "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
const GREEN = "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";

const Badge = ({ className, children }: { className: string; children: React.ReactNode }) => (
  <span className={`text-[10px] px-1.5 py-0.5 rounded-md border font-medium whitespace-nowrap ${className}`}>
    {children}
  </span>
);

const shortId = (id: string) => `BUG-${id.replace(/-/g, "").slice(0, 4).toUpperCase()}`;

const severityStyle = (s?: string | null) => {
  const v = (s || "").toLowerCase();
  if (v.startsWith("crit") || v === "high") return RED;
  if (v.startsWith("maj") || v === "medium") return AMBER;
  return NEUTRAL;
};
const severityLabel = (s?: string | null) => {
  const v = (s || "").toLowerCase();
  if (v.startsWith("crit") || v === "high") return "Critical";
  if (v.startsWith("maj") || v === "medium") return "Major";
  if (!v) return "Minor";
  return s!.charAt(0).toUpperCase() + s!.slice(1);
};

const Stat = ({
  label,
  value,
  className,
  accent = "bg-border",
}: {
  label: string;
  value: number | string;
  className?: string;
  accent?: string;
}) => (
  <div className="group relative overflow-hidden rounded-xl border border-border bg-card px-4 py-3.5 transition-all duration-300 hover:border-primary/30 hover:shadow-[0_8px_30px_-12px_hsl(var(--norman-glow)/0.35)]">
    <span className={`absolute inset-x-0 top-0 h-0.5 ${accent} opacity-70`} />
    <div className={`text-3xl font-bold tracking-tight tabular-nums ${className ?? "text-foreground"}`}>{value}</div>
    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">{label}</div>
  </div>
);

export default function BugReportsBoard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAdmin } = useIsAdmin();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "open" | "fixed">("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["all-bug-reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("issues")
        .select("id, title, description, issue_type, severity, affected_area, user_email, created_at, resolved_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Issue[];
    },
  });

  const rows = data ?? [];
  const total = rows.length;
  const fixed = rows.filter((r) => r.resolved_at).length;
  const open = total - fixed;
  const rate = total ? Math.round((fixed / total) * 100) : 0;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "open" && r.resolved_at) return false;
      if (filter === "fixed" && !r.resolved_at) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q) ||
        (r.user_email || "").toLowerCase().includes(q) ||
        shortId(r.id).toLowerCase().includes(q)
      );
    });
  }, [rows, search, filter]);

  const toggleResolved = async (r: Issue) => {
    const resolved_at = r.resolved_at ? null : new Date().toISOString();
    const { error } = await supabase.from("issues").update({ resolved_at } as any).eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success(resolved_at ? "Marked fixed" : "Reopened");
    qc.invalidateQueries({ queryKey: ["all-bug-reports"] });
    qc.invalidateQueries({ queryKey: ["home-latest-bugs"] });
  };

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="gradient-radial">
        <div className="max-w-5xl mx-auto p-4 sm:p-8 space-y-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10">
                <Bug className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Bug Reports</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Every reported bug and its current status.{!isAdmin && " View only — admins manage status."}
                </p>
              </div>
            </div>
            <button
              onClick={() => navigate("/feedback")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-medium text-foreground hover:border-primary/40 hover:bg-secondary/60 transition-all duration-200"
            >
              <Plus className="h-3.5 w-3.5" /> Report a bug
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Total reported" value={isLoading ? "…" : total} accent="bg-primary/60" />
            <Stat label="Fixed" value={isLoading ? "…" : fixed} className="text-emerald-600 dark:text-emerald-400" accent="bg-emerald-500/70" />
            <Stat label="Open" value={isLoading ? "…" : open} className="text-amber-600 dark:text-amber-400" accent="bg-amber-500/70" />
            <Stat label="Resolution rate" value={isLoading ? "…" : `${rate}%`} accent="bg-primary/60" />
          </div>

          <div className="rounded-xl border border-border bg-card/60 backdrop-blur-sm p-2 flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search bugs, reporter or ID…"
                className="w-full rounded-lg border border-transparent bg-background/60 pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary/40 focus:bg-background transition-colors"
              />
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-background/60 p-1">
              {(["all", "open", "fixed"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-all duration-200 ${
                    filter === f
                      ? "bg-primary/10 text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <p className="text-sm text-muted-foreground">Unable to load bug reports.</p>
          ) : isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-16 text-center">
              <Bug className="mx-auto h-6 w-6 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground mt-2">No bug reports found.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {visible.map((r) => (
                <div
                  key={r.id}
                  className={`group relative overflow-hidden rounded-xl border border-border bg-card p-4 space-y-2 transition-all duration-300 hover:border-primary/30 hover:shadow-[0_8px_30px_-16px_hsl(var(--norman-glow)/0.4)]`}
                >
                  <span
                    className={`absolute inset-y-0 left-0 w-0.5 ${r.resolved_at ? "bg-emerald-500/70" : "bg-amber-500/70"}`}
                  />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                          {shortId(r.id)}
                        </span>
                        <span className="text-sm font-semibold text-foreground truncate">{r.title}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {r.user_email ?? "Unknown"} · {format(new Date(r.created_at), "MMM d, yyyy")}
                        {r.affected_area ? ` · ${r.affected_area}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5 flex-wrap justify-end">
                      {r.issue_type && <Badge className={NEUTRAL}>{r.issue_type}</Badge>}
                      <Badge className={severityStyle(r.severity)}>{severityLabel(r.severity)}</Badge>
                      <Badge className={r.resolved_at ? GREEN : AMBER}>{r.resolved_at ? "Fixed" : "Open"}</Badge>
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap line-clamp-3">{r.description}</p>
                  {isAdmin && (
                    <div className="pt-1">
                      <button
                        onClick={() => toggleResolved(r)}
                        className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:border-primary/40 hover:bg-secondary/60 transition-all duration-200"
                      >
                        {r.resolved_at ? "Reopen" : "Mark fixed"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
