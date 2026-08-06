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

/** Illustrative placeholder shown until the first real survey responses land. */
export const SAMPLE_PEOPLE_CULTURE: PeopleCultureData = {
  responses: 24,
  lastResponse: new Date().toISOString(),
  overall: 78,
  enps: 42,
  metrics: [
    { question: "I understand how my work contributes to Kabuni's goals", average: 4.3, scaleMax: 5, normalised: 86, responses: 24 },
    { question: "I have the tools and information I need to do my job well", average: 3.9, scaleMax: 5, normalised: 78, responses: 24 },
    { question: "I feel recognised for the work I do", average: 3.4, scaleMax: 5, normalised: 68, responses: 24 },
    { question: "My workload is manageable", average: 3.2, scaleMax: 5, normalised: 64, responses: 23 },
    { question: "I can raise concerns openly with leadership", average: 4.1, scaleMax: 5, normalised: 82, responses: 24 },
    { question: "I see a clear path to grow my career here", average: 3.6, scaleMax: 5, normalised: 72, responses: 22 },
  ],
};

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
