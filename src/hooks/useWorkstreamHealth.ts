import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePlan90 } from "@/hooks/usePlan90";
import { usePlan90Updates } from "@/hooks/usePlan90Updates";
import type { Rag } from "@/components/company-health/HealthPrimitives";

/**
 * WORKSTREAM DELIVERY HEALTH — live aggregation, no stored dataset.
 * Sources (single source of truth = the 90-Day Tracker):
 *   • plan90_workstreams          -> rows
 *   • plan90_deliverables         -> counts, completion, due dates, priority
 *   • plan90_deliverable_updates  -> average update age + average RAG health
 *   • workstream_cards            -> open kanban cards mapped by category name
 * Everything is derived on the fly; both plan90 hooks are realtime-subscribed,
 * so any tracker change re-renders this view immediately.
 */

export interface WorkstreamHealthRow {
  id: string;
  name: string;
  completed: number;
  total: number;
  completionPct: number;
  avgRag: Rag | null;
  critical: number;
  overdue: number;
  dueThisWeek: number;
  avgUpdateAgeDays: number | null;
  openCards: number;
  health: Rag;
}

const RAG_POINTS: Record<Rag, number> = { on_track: 100, attention: 65, critical: 30 };

function rygToRag(r: string): Rag {
  if (r === "green") return "on_track";
  if (r === "amber") return "attention";
  return "critical";
}

function pointsToRag(p: number): Rag {
  if (p >= 80) return "on_track";
  if (p >= 55) return "attention";
  return "critical";
}

/** Open (non-archived, not done) kanban cards grouped by category label. */
function useOpenCardsByCategory() {
  const [map, setMap] = useState<Record<string, number>>({});
  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await supabase
        .from("workstream_cards")
        .select("category, status, archived_at")
        .is("archived_at", null);
      if (!active) return;
      const next: Record<string, number> = {};
      for (const c of (data as any[]) || []) {
        if (c.status === "done") continue;
        const key = String(c.category || "").toLowerCase().trim();
        if (!key) continue;
        next[key] = (next[key] || 0) + 1;
      }
      setMap(next);
    };
    load();
    const ch = supabase
      .channel("ws-health-cards")
      .on("postgres_changes", { event: "*", schema: "public", table: "workstream_cards" }, () => load())
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, []);
  return map;
}

export function useWorkstreamHealth() {
  const { workstreams, deliverables, loading } = usePlan90();
  const { latestByDeliverable, loading: updatesLoading } = usePlan90Updates();
  const cardsByCategory = useOpenCardsByCategory();

  const rows = useMemo<WorkstreamHealthRow[]>(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);

    return workstreams
      .filter((w) => !w.archived)
      .map((w) => {
        const items = deliverables.filter((d) => d.workstream_id === w.id && !d.archived);
        const total = items.length;
        const completed = items.filter((d) => d.status === "Completed").length;
        const open = items.filter((d) => d.status !== "Completed");
        const completionPct = total ? Math.round((completed / total) * 100) : 0;

        const overdue = open.filter((d) => d.due_date && new Date(d.due_date) < today).length;
        const dueThisWeek = open.filter((d) => {
          if (!d.due_date) return false;
          const due = new Date(d.due_date);
          return due >= today && due <= weekEnd;
        }).length;
        const critical = open.filter((d) => d.priority === "Critical").length;

        // Average RAG health + average update age from the latest update per deliverable
        let ragSum = 0, ragCount = 0, ageSum = 0, ageCount = 0;
        for (const d of items) {
          const u = latestByDeliverable.get(d.id);
          if (!u) continue;
          ragSum += RAG_POINTS[rygToRag(u.ryg)];
          ragCount += 1;
          ageSum += (Date.now() - new Date(u.created_at).getTime()) / 86_400_000;
          ageCount += 1;
        }
        const avgRag: Rag | null = ragCount ? pointsToRag(ragSum / ragCount) : null;
        const avgUpdateAgeDays = ageCount ? Math.round((ageSum / ageCount) * 10) / 10 : null;

        // ---- Overall Delivery Health (automatic, no manual override) ----
        // Start from completion %, then apply deterministic penalties.
        let score = completionPct;
        if (avgRag) score = score * 0.5 + RAG_POINTS[avgRag] * 0.5;
        if (total === 0) score = 0;
        score -= overdue * 12;                               // overdue deliverables
        score -= critical * 6;                               // open critical work
        if (avgUpdateAgeDays === null) score -= 15;          // never updated
        else if (avgUpdateAgeDays > 21) score -= 20;         // very stale
        else if (avgUpdateAgeDays > 14) score -= 10;         // stale
        score = Math.max(0, Math.min(100, Math.round(score)));

        return {
          id: w.id,
          name: w.name,
          completed,
          total,
          completionPct,
          avgRag,
          critical,
          overdue,
          dueThisWeek,
          avgUpdateAgeDays,
          openCards: cardsByCategory[w.name.toLowerCase().trim()] || 0,
          health: pointsToRag(score),
        };
      });
  }, [workstreams, deliverables, latestByDeliverable, cardsByCategory]);

  const overall = useMemo<Rag>(() => {
    if (!rows.length) return "attention";
    const avg = rows.reduce((s, r) => s + RAG_POINTS[r.health], 0) / rows.length;
    return pointsToRag(avg);
  }, [rows]);

  return { rows, overall, loading: loading || updatesLoading };
}
