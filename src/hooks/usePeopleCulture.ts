import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PeopleCultureMetric {
  question: string;
  average: number;
  scaleMax: number;
  normalised: number; // 0-100
  responses: number;
}

export interface PeopleCultureData {
  responses: number;
  lastResponse: string | null;
  overall: number | null; // 0-100 sentiment index
  enps: number | null;
  metrics: PeopleCultureMetric[];
}

export type Rag = "on_track" | "attention" | "critical";

function ragFor(overall: number | null): Rag {
  if (overall === null) return "attention";
  if (overall >= 75) return "on_track";
  if (overall >= 60) return "attention";
  return "critical";
}

/**
 * Live People & Culture metrics from the employee survey Google Sheet,
 * read server-side by the `people-culture-metrics` edge function.
 */
export function usePeopleCulture() {
  const query = useQuery({
    queryKey: ["people-culture-metrics"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PeopleCultureData> => {
      const { data, error } = await supabase.functions.invoke("people-culture-metrics");
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return {
        responses: data.responses ?? 0,
        lastResponse: data.lastResponse ?? null,
        overall: data.overall ?? null,
        enps: data.enps ?? null,
        metrics: data.metrics ?? [],
      };
    },
  });

  return {
    ...query,
    data: query.data,
    rag: ragFor(query.data?.overall ?? null),
  };
}
