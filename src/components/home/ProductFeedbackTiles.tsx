import { useEffect } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bug, Lightbulb, ExternalLink, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/* ---------- shell (mirrors home dashboard tiles) ---------- */
const Tile = ({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.35 }}
    className="rounded-xl border border-border bg-card p-4 sm:p-5"
  >
    {children}
  </motion.div>
);

const TileHeader = ({
  icon: Icon,
  label,
  count,
  onViewAll,
}: {
  icon: any;
  label: string;
  count?: number;
  onViewAll: () => void;
}) => (
  <div className="flex items-center justify-between mb-3 gap-2">
    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground min-w-0">
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
      {count != null && (
        <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-foreground">
          {count}
        </span>
      )}
    </div>
    <button
      onClick={onViewAll}
      className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 shrink-0"
    >
      View all <ExternalLink className="h-2.5 w-2.5" />
    </button>
  </div>
);

const Badge = ({ className, children }: { className: string; children: React.ReactNode }) => (
  <span className={`text-[10px] px-1.5 py-0.5 rounded-md border font-medium whitespace-nowrap ${className}`}>
    {children}
  </span>
);

const NEUTRAL = "bg-muted text-muted-foreground border-border";
const RED = "bg-destructive/10 text-destructive border-destructive/20";
const AMBER = "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
const GREEN = "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
const BLUE = "bg-primary/10 text-primary border-primary/20";

const shortId = (prefix: string, id: string) => `${prefix}-${id.replace(/-/g, "").slice(0, 4).toUpperCase()}`;

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

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

const FEATURE_STATUS: Record<string, { label: string; className: string }> = {
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

/* ---------- realtime invalidation ---------- */
function useFeedbackRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("home-product-feedback")
      .on("postgres_changes", { event: "*", schema: "public", table: "issues" }, () => {
        qc.invalidateQueries({ queryKey: ["home-latest-bugs"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "feature_requests" }, () => {
        qc.invalidateQueries({ queryKey: ["home-latest-features"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}

type BugRow = {
  id: string;
  title: string;
  severity: string | null;
  user_email: string | null;
  created_at: string;
  resolved_at: string | null;
};

type FeatureRow = {
  id: string;
  title: string;
  status: string | null;
  user_email: string | null;
  created_at: string;
};

function useLatestBugs() {
  return useQuery({
    queryKey: ["home-latest-bugs"],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const [list, fixed] = await Promise.all([
        supabase
          .from("issues")
          .select("id, title, severity, user_email, created_at, resolved_at", { count: "exact" })
          .order("created_at", { ascending: false })
          .limit(3),
        supabase.from("issues").select("id", { count: "exact", head: true }).not("resolved_at", "is", null),
      ]);
      if (list.error) throw list.error;
      const total = list.count ?? 0;
      const fixedCount = fixed.count ?? 0;
      return { rows: (list.data ?? []) as BugRow[], total, fixed: fixedCount, open: Math.max(total - fixedCount, 0) };
    },
  });
}

const DONE_STATUSES = ["completed", "released"];

function useLatestFeatures() {
  return useQuery({
    queryKey: ["home-latest-features"],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const [list, done] = await Promise.all([
        supabase
          .from("feature_requests")
          .select("id, title, status, user_email, created_at", { count: "exact" })
          .order("created_at", { ascending: false })
          .limit(3),
        supabase.from("feature_requests").select("id", { count: "exact", head: true }).in("status", DONE_STATUSES),
      ]);
      if (list.error) throw list.error;
      const total = list.count ?? 0;
      const doneCount = done.count ?? 0;
      return { rows: (list.data ?? []) as FeatureRow[], total, completed: doneCount, open: Math.max(total - doneCount, 0) };
    },
  });
}

const HeadlineStats = ({
  items,
}: {
  items: { label: string; value: number; className?: string }[];
}) => (
  <div className="grid grid-cols-3 gap-2 mb-3">
    {items.map((i) => (
      <div key={i.label} className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
        <div className={`text-2xl sm:text-3xl font-bold tracking-tight tabular-nums ${i.className ?? "text-foreground"}`}>
          {i.value}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{i.label}</div>
      </div>
    ))}
  </div>
);

const Meta = ({ by, date }: { by: string | null; date: string }) => (
  <div className="text-[10px] text-muted-foreground truncate">
    {by || "Unknown"} · {fmtDate(date)}
  </div>
);

function LatestBugsTile() {
  const navigate = useNavigate();
  const { data, isLoading } = useLatestBugs();
  const rows = data?.rows ?? [];

  return (
    <Tile delay={0.06}>
      <TileHeader icon={Bug} label="Latest bug reports" count={data?.total} onViewAll={() => navigate("/feedback")} />
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No bug reports found.</p>
      ) : (
        <div className="divide-y divide-border/40">
          {rows.map((r) => (
            <button
              key={r.id}
              onClick={() => navigate("/feedback")}
              className="w-full text-left flex items-center gap-3 py-2 hover:bg-muted/30 rounded-md px-1 -mx-1 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">{shortId("BUG", r.id)}</span>
                  <span className="text-xs font-medium text-foreground truncate">{r.title}</span>
                </div>
                <Meta by={r.user_email} date={r.created_at} />
              </div>
              <div className="shrink-0 flex items-center gap-1.5">
                <Badge className={severityStyle(r.severity)}>{severityLabel(r.severity)}</Badge>
                <Badge className={r.resolved_at ? GREEN : AMBER}>{r.resolved_at ? "Fixed" : "Open"}</Badge>
              </div>
            </button>
          ))}
        </div>
      )}
    </Tile>
  );
}

function LatestFeatureRequestsTile() {
  const navigate = useNavigate();
  const { data, isLoading } = useLatestFeatures();
  const rows = data?.rows ?? [];

  return (
    <Tile delay={0.08}>
      <TileHeader
        icon={Lightbulb}
        label="Latest feature requests"
        count={data?.total}
        onViewAll={() => navigate("/feature-requests")}
      />
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No feature requests found.</p>
      ) : (
        <div className="divide-y divide-border/40">
          {rows.map((r) => {
            const s = FEATURE_STATUS[(r.status || "new").toLowerCase()] ?? { label: r.status || "New", className: NEUTRAL };
            return (
              <button
                key={r.id}
                onClick={() => navigate("/feature-requests")}
                className="w-full text-left flex items-center gap-3 py-2 hover:bg-muted/30 rounded-md px-1 -mx-1 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">{shortId("FR", r.id)}</span>
                    <span className="text-xs font-medium text-foreground truncate">{r.title}</span>
                  </div>
                  <Meta by={r.user_email} date={r.created_at} />
                </div>
                <Badge className={`shrink-0 ${s.className}`}>{s.label}</Badge>
              </button>
            );
          })}
        </div>
      )}
    </Tile>
  );
}

export function ProductFeedbackTiles() {
  useFeedbackRealtime();
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
      <LatestBugsTile />
      <LatestFeatureRequestsTile />
    </div>
  );
}

export default ProductFeedbackTiles;
