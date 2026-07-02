import { useQuery } from "@tanstack/react-query";
import { Trophy, Users, Globe2, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// Heuristic: every Duncan interaction saves ~6 minutes of manual work.
const HOURS_PER_REQUEST = 0.1;

type Row = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  total_tokens: number;
  request_count: number;
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

export const LeaderboardSection = () => {
  const { user } = useAuth();
  const { data, isLoading } = useLeaderboard();

  const rows = data ?? [];
  const me = rows.find((r) => r.user_id === user?.id);
  const myTokens = me?.total_tokens ?? 0;
  const myHours = (me?.request_count ?? 0) * HOURS_PER_REQUEST;

  const totalTokens = rows.reduce((s, r) => s + r.total_tokens, 0);
  const totalRequests = rows.reduce((s, r) => s + r.request_count, 0);
  const totalHours = totalRequests * HOURS_PER_REQUEST;

  const top = [...rows].slice(0, 10);

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
                    const hours = r.request_count * HOURS_PER_REQUEST;
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
                Hours saved estimated at ~6 minutes per Duncan interaction.
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default LeaderboardSection;
