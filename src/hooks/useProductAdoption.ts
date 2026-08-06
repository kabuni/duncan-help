import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/* ------------------------------------------------------------------
   Product Adoption data layer (Company Health).

   SOURCE: Azure DevOps, live, via the `azure-devops-api` edge function
   (action: "work_item_counts"). Org-wide WIQL counts:
     • inProgress   -> [System.State] = 'In Progress'
     • closed       -> [System.State] = 'Closed'
     • closed30     -> closed in the last 30 days
     • closedPrev30 -> closed in the 30 days before that

   Velocity is DERIVED (never stored): closed30 / 4.3 weeks = tickets closed
   per week, with the trend taken against the previous 30-day window.
------------------------------------------------------------------- */

export type Trend = "up" | "down" | "flat";

const WEEKS_IN_30D = 30 / 7;

export interface WorkItemCounts {
  inProgress: number;
  closed: number;
  closed30: number;
  closedPrev30: number;
  generatedAt: string;
}

export interface ProductAdoption {
  /** "18 / 74" — In Progress / Closed. */
  tickets: { formatted: string; inProgress: number; closed: number } | null;
  /** Tickets closed per week over the last 30 days. */
  velocity: { value: number; formatted: string; trend: Trend } | null;
  isLoading: boolean;
  error: Error | null;
  live: boolean;
}

export function useProductAdoption(): ProductAdoption {
  const query = useQuery({
    queryKey: ["product-adoption-work-items"],
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<WorkItemCounts> => {
      const { data, error } = await supabase.functions.invoke("azure-devops-api", {
        body: { action: "work_item_counts" },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data as WorkItemCounts;
    },
  });

  const d = query.data ?? null;

  const velocityValue = d ? d.closed30 / WEEKS_IN_30D : 0;
  const velocityPrev = d ? d.closedPrev30 / WEEKS_IN_30D : 0;
  const trend: Trend =
    !d || !velocityPrev ? "flat" : velocityValue > velocityPrev ? "up" : velocityValue < velocityPrev ? "down" : "flat";

  return {
    tickets: d ? { formatted: `${d.inProgress} / ${d.closed}`, inProgress: d.inProgress, closed: d.closed } : null,
    velocity: d ? { value: velocityValue, formatted: `${velocityValue.toFixed(1)} / week`, trend } : null,
    isLoading: query.isLoading,
    error: (query.error as Error) ?? null,
    live: !!d,
  };
}
