export type TourStep = {
  target: string; // data-tour attribute value
  title: string;
  body: string;
  route?: string; // navigate before showing
  placement?: "top" | "bottom" | "left" | "right" | "auto";
  spotlightPadding?: number;
  allowInteraction?: boolean; // let user click through spotlight
};

export type TourDefinition = {
  id: string;
  name: string;
  description: string;
  eta: string; // e.g. "3 min"
  route: string; // starting route
  steps: TourStep[];
};

export type TourProgressEntry = {
  status: "not_started" | "in_progress" | "completed" | "skipped";
  step: number;
  total: number;
  updated_at?: string;
  completed_at?: string | null;
};

export type TourProgressMap = Record<string, TourProgressEntry>;
