import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Users, Globe2, Loader2, ChevronDown, ChevronUp, Medal, Crown } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type Row = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  total_tokens: number;
  request_count: number;
  minutes_saved: number;
};

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n));
const fmtHours = (h: number) =>
  h >= 100 ? fmt(h) : h.toFixed(h >= 10 ? 1 : 2);

function useLeaderboard() {
  return useQuery<Row[]>({
    queryKey: ["home-dashboard", "token-leaderboard"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_token_leaderboard");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        user_id: r.user_id,
        display_name: r.display_name ?? "Unknown",
        avatar_url: r.avatar_url ?? null,
        total_tokens: Number(r.total_tokens ?? 0),
        request_count: Number(r.request_count ?? 0),
        minutes_saved: Number(r.minutes_saved ?? 0),
      }));
    },
  });
}


const Card = ({
  icon: Icon,
  label,
  children,
  delay = 0,
}: {
  icon: any;
  label: string;
  children: React.ReactNode;
  delay?: number;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.35 }}
    className="rounded-xl border border-border bg-card p-4 sm:p-5"
  >
    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
      <Icon className="h-3 w-3" />
      {label}
    </div>
    {children}
  </motion.div>
);

const Metric = ({ value, label }: { value: React.ReactNode; label: string }) => (
  <div>
    <div className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight tabular-nums">
      {value}
    </div>
    <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
  </div>
);

const PODIUM = [
  { order: "order-2 md:order-1", height: "h-16", ring: "ring-slate-400/40", chip: "bg-slate-400/15 text-slate-500 dark:text-slate-300", icon: Medal, place: 2 },
  { order: "order-1 md:order-2", height: "h-24", ring: "ring-amber-400/50", chip: "bg-amber-400/15 text-amber-600 dark:text-amber-400", icon: Crown, place: 1 },
  { order: "order-3", height: "h-12", ring: "ring-orange-500/40", chip: "bg-orange-500/15 text-orange-600 dark:text-orange-400", icon: Medal, place: 3 },
];

const Podium = ({ rows, meId }: { rows: Row[]; meId?: string }) => {
  const byPlace = (p: number) => rows[p - 1];
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3 items-end">
      {PODIUM.map((p) => {
        const r = byPlace(p.place);
        if (!r) return <div key={p.place} className={p.order} />;
        const Icon = p.icon;
        const mine = r.user_id === meId;
        const initials = (r.display_name || "?")
          .split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
        return (
          <div key={p.place} className={`${p.order} flex flex-col items-center text-center`}>
            <div className={`relative rounded-full ring-2 ${p.ring} bg-muted overflow-hidden h-11 w-11 sm:h-12 sm:w-12 flex items-center justify-center`}>
              {r.avatar_url ? (
                <img src={r.avatar_url} alt={r.display_name} className="h-full w-full object-cover" />
              ) : (
                <span className="text-[11px] font-semibold text-muted-foreground">{initials}</span>
              )}
            </div>
            <div className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-widest ${p.chip}`}>
              <Icon className="h-2.5 w-2.5" /> #{p.place}
            </div>
            <div className="mt-1 text-[11px] font-medium text-foreground truncate max-w-full">
              {r.display_name}
              {mine && <span className="ml-1 text-primary">·you</span>}
            </div>
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {fmtHours(r.minutes_saved / 60)} h · {fmt(r.total_tokens)} tk
            </div>
            <div className={`${p.height} w-full mt-2 rounded-t-lg border border-b-0 border-border bg-gradient-to-t from-muted/20 to-primary/10`} />
          </div>
        );
      })}
    </div>
  );
};

export const LeaderboardSection = () => {
  const { user } = useAuth();
  const { data, isLoading } = useLeaderboard();
  const [expanded, setExpanded] = useState(false);

  const rows = data ?? [];
  const me = rows.find((r) => r.user_id === user?.id);
  const myTokens = me?.total_tokens ?? 0;
  const myHours = (me?.minutes_saved ?? 0) / 60;

  const totalTokens = rows.reduce((s, r) => s + r.total_tokens, 0);
  const totalRequests = rows.reduce((s, r) => s + r.request_count, 0);
  const totalHours = rows.reduce((s, r) => s + r.minutes_saved, 0) / 60;

  const top = expanded ? rows : rows.slice(0, 10);


  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
      {/* PERSONAL */}
      <Card icon={Trophy} label="Your usage" delay={0.06}>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Metric value={fmt(myTokens)} label="Tokens spent" />
            <Metric value={fmtHours(myHours)} label="Hours saved" />
          </div>
        )}
      </Card>

      {/* COMPANY TOTAL */}
      <Card icon={Globe2} label="Company total" delay={0.08}>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Metric value={fmt(totalTokens)} label="Tokens used (all users)" />
            <Metric value={fmtHours(totalHours)} label="Hours saved (all users)" />
          </div>
        )}
      </Card>

      {/* GLOBAL LEADERBOARD */}
      <div className="md:col-span-2">
        <Card icon={Users} label={`Team leaderboard${rows.length ? ` · ${rows.length}` : ""}`} delay={0.1}>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">No usage recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                    <th className="text-left py-1.5 pr-3 w-8">#</th>
                    <th className="text-left py-1.5 pr-3">User</th>
                    <th className="text-right py-1.5 pr-3">Tokens spent</th>
                    <th className="text-right py-1.5">Hours saved</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((r, i) => {
                    const hours = r.minutes_saved / 60;
                    const mine = r.user_id === user?.id;
                    return (
                      <tr
                        key={r.user_id}
                        className={`border-b border-border/40 last:border-0 ${mine ? "bg-primary/5" : ""}`}
                      >
                        <td className="py-1.5 pr-3 text-muted-foreground font-mono">{i + 1}</td>
                        <td className="py-1.5 pr-3 text-foreground font-medium">
                          {r.display_name}
                          {mine && (
                            <span className="ml-2 text-[10px] text-primary font-mono uppercase tracking-widest">
                              you
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-foreground">{fmt(r.total_tokens)}</td>
                        <td className="py-1.5 text-right text-foreground">{fmtHours(hours)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="text-[10px] text-muted-foreground/70 mt-2">
                Estimated effort avoided. Each completed Duncan action is valued using the
                admin-maintained rate table, so the figure reflects manual work replaced —
                not capacity released.
              </div>


            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default LeaderboardSection;
