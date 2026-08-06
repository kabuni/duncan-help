import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PeopleCultureMetric {
  question: string;
  average: number;
  scaleMax: number;
  normalised: number; // 0-100
  responses: number;
}

export interface PeopleCultureTheme {
  key: string;
  label: string;
  description: string;
  score: number; // 0-100
  questions: number;
}

export interface PeopleCultureData {
  themes: PeopleCultureTheme[];
  strength: PeopleCultureTheme | null;
  risk: PeopleCultureTheme | null;
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
  overall: 74,
  enps: 42,
  metrics: [],
  themes: [
    { key: "satisfaction", label: "Employee Satisfaction", description: "Engagement, wellbeing, recognition and overall happiness", score: 70, questions: 5 },
    { key: "alignment", label: "Alignment & Growth", description: "Clarity of direction, enablement, learning and progression", score: 74, questions: 6 },
    { key: "culture", label: "Culture & Connection", description: "Belonging, inclusion, trust in leadership and team connection", score: 82, questions: 5 },
  ],
  strength: { key: "culture", label: "Culture & Connection", description: "Belonging, inclusion, trust in leadership and team connection", score: 82, questions: 5 },
  risk: { key: "satisfaction", label: "Employee Satisfaction", description: "Engagement, wellbeing, recognition and overall happiness", score: 70, questions: 5 },
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
        themes: data.themes ?? [],
        strength: data.strength ?? null,
        risk: data.risk ?? null,
      };
    },
  });

  return {
    ...query,
    data: query.data,
    rag: ragFor(query.data?.overall ?? null),
  };
}
