import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { RagBadge } from "@/components/company-health/HealthPrimitives";
import { useWorkstreamHealth } from "@/hooks/useWorkstreamHealth";

/**
 * Purely a live aggregated view of the 90-Day Tracker (plan90_* tables) plus
 * open workstream_cards. Nothing here is editable or stored separately.
 */
export default function WorkstreamDeliveryHealth() {
  const { rows, loading } = useWorkstreamHealth();

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Delivery health per workstream, derived live from the 90-Day Tracker</caption>
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Workstream", "Completed", "Completion", "Avg RAG", "Critical", "Due this week", "Avg update age", "Delivery health"].map((h) => (
                <th key={h} scope="col" className="text-left font-medium text-[11px] uppercase tracking-wider text-muted-foreground px-4 py-2.5 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                <th scope="row" className="text-left px-4 py-3 font-medium whitespace-nowrap">
                  <Link to={`/plan-90?workstream=${r.id}`} className="inline-flex items-center gap-1 text-foreground hover:text-primary transition-colors">
                    {r.name}
                    <ChevronRight className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
                  </Link>
                  {r.openCards > 0 && (
                    <span className="block text-[10px] text-muted-foreground font-normal mt-0.5 tabular-nums">{r.openCards} open cards</span>
                  )}
                </th>
                <td className="px-4 py-3 tabular-nums text-foreground whitespace-nowrap">
                  {r.completed}/{r.total}
                  {r.overdue > 0 && <span className="text-red-500"> · {r.overdue} overdue</span>}
                </td>
                <td className="px-4 py-3 min-w-[140px]">
                  <div className="flex items-center gap-2">
                    <Progress value={r.completionPct} className="h-1.5 flex-1" aria-label={`${r.name} completion ${r.completionPct}%`} />
                    <span className="text-xs tabular-nums text-muted-foreground">{r.completionPct}%</span>
                  </div>
                </td>
                <td className="px-4 py-3">{r.avgRag ? <RagBadge rag={r.avgRag} /> : <span className="text-xs text-muted-foreground">No updates</span>}</td>
                <td className={cn("px-4 py-3 tabular-nums", r.critical > 0 ? "text-red-500 font-semibold" : "text-foreground")}>{r.critical}</td>
                <td className="px-4 py-3 tabular-nums text-foreground">{r.dueThisWeek}</td>
                <td className="px-4 py-3 tabular-nums text-foreground whitespace-nowrap">
                  {r.avgUpdateAgeDays === null ? <span className="text-muted-foreground">—</span> : `${r.avgUpdateAgeDays}d`}
                </td>
                <td className="px-4 py-3"><RagBadge rag={r.health} /></td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-xs text-muted-foreground">
                  {loading ? "Loading workstreams…" : "No workstreams in the 90-Day Tracker yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
