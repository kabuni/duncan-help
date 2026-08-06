import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Bugs reported vs solved — live from public.issues.
 * "Solved" = rows with a resolved_at timestamp (set by admins in
 * Settings → Reported bugs).
 */
export default function BugsTile() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["company-health-bugs"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("issues").select("resolved_at");
      if (error) throw error;
      const rows = (data ?? []) as { resolved_at: string | null }[];
      const reported = rows.length;
      const solved = rows.filter((r) => r.resolved_at).length;
      return { reported, solved };
    },
  });

  const reported = data?.reported ?? 0;
  const solved = data?.solved ?? 0;
  const rate = reported > 0 ? Math.round((solved / reported) * 100) : 0;

  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">
        Bugs reported vs solved
      </p>
      {error ? (
        <p className="text-xs text-muted-foreground py-2">Unable to load bug reports.</p>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3 py-2 border-b border-border">
            <span className="text-xs text-muted-foreground">Reported / solved</span>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {isLoading ? "…" : `${reported} / ${solved}`}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3 py-2">
            <span className="text-xs text-muted-foreground">Resolution rate</span>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {isLoading ? "…" : `${rate}%`}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
