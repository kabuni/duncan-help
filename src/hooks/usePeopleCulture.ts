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
    { key: "wellbeing", label: "Wellbeing & Workload", description: "Sustainable pace, balance and stress", score: 61, questions: 3 },
    { key: "recognition", label: "Recognition & Reward", description: "Being valued, recognised and fairly rewarded", score: 66, questions: 2 },
    { key: "growth", label: "Growth & Development", description: "Learning, progression and career path", score: 71, questions: 3 },
    { key: "enablement", label: "Enablement", description: "Tools, information and clarity to do the job", score: 77, questions: 4 },
    { key: "leadership", label: "Leadership & Trust", description: "Confidence in leadership and transparency", score: 80, questions: 3 },
    { key: "engagement", label: "Engagement & Motivation", description: "Energy, pride and discretionary effort", score: 83, questions: 3 },
    { key: "belonging", label: "Belonging & Inclusion", description: "Psychological safety, respect and team connection", score: 85, questions: 2 },
  ],
  strength: { key: "belonging", label: "Belonging & Inclusion", description: "Psychological safety, respect and team connection", score: 85, questions: 2 },
  risk: { key: "wellbeing", label: "Wellbeing & Workload", description: "Sustainable pace, balance and stress", score: 61, questions: 3 },
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
