import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useQueryClient } from "@tanstack/react-query";
import { TOURS } from "./tours";
import type { TourProgressMap } from "./types";
import { TourOverlay } from "./TourOverlay";

type Ctx = {
  activeTourId: string | null;
  activeStep: number;
  progress: TourProgressMap;
  start: (tourId: string, opts?: { restart?: boolean }) => void;
  stop: () => void;
  next: () => void;
  back: () => void;
  skip: () => void;
};

const TourCtx = createContext<Ctx | null>(null);
export const useTour = () => {
  const ctx = useContext(TourCtx);
  if (!ctx) throw new Error("useTour must be used within TourProvider");
  return ctx;
};

// Module tours (Projects, Project Workspace, Workstreams, Planner) are launch-on-demand
// only — via the in-page Tutorial button or Learn Duncan. We do NOT autostart them,
// otherwise every first visit to each module fires a walkthrough and it feels constant.
const AUTOSTART_MATCHERS: Array<{ test: (path: string) => boolean; tour: string }> = [];

export function TourProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { profile } = useProfile();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const autoStartedRef = useRef<Set<string>>(new Set());

  const progress: TourProgressMap = useMemo(
    () => ((profile as any)?.tutorial_progress as TourProgressMap) ?? {},
    [profile]
  );

  const persist = useCallback(
    async (next: TourProgressMap) => {
      if (!user) return;
      await supabase.from("profiles").update({ tutorial_progress: next } as any).eq("user_id", user.id);
      qc.invalidateQueries({ queryKey: ["profile", user.id] });
    },
    [user, qc]
  );

  const start = useCallback(
    (tourId: string, opts?: { restart?: boolean }) => {
      const tour = TOURS[tourId];
      if (!tour) return;
      const existing = progress[tourId];
      const startStep =
        !opts?.restart && existing?.status === "in_progress" ? Math.min(existing.step, tour.steps.length - 1) : 0;
      setActiveTourId(tourId);
      setActiveStep(startStep);
      const matches = tour.matchRoute ? tour.matchRoute(location.pathname) : location.pathname === tour.route;
      if (!matches && tour.steps[startStep]?.route) {
        navigate(tour.steps[startStep].route!);
      } else if (!matches) {
        navigate(tour.route);
      }
      persist({
        ...progress,
        [tourId]: {
          status: "in_progress",
          step: startStep,
          total: tour.steps.length,
          updated_at: new Date().toISOString(),
          completed_at: null,
        },
      });
    },
    [progress, persist, navigate, location.pathname]
  );

  const stop = useCallback(() => {
    setActiveTourId(null);
    setActiveStep(0);
  }, []);

  const next = useCallback(() => {
    if (!activeTourId) return;
    const tour = TOURS[activeTourId];
    const nextIdx = activeStep + 1;
    if (nextIdx >= tour.steps.length) {
      // complete
      persist({
        ...progress,
        [activeTourId]: {
          status: "completed",
          step: tour.steps.length,
          total: tour.steps.length,
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
      });
      stop();
      return;
    }
    const step = tour.steps[nextIdx];
    if (step.route && location.pathname !== step.route) navigate(step.route);
    setActiveStep(nextIdx);
    persist({
      ...progress,
      [activeTourId]: {
        status: "in_progress",
        step: nextIdx,
        total: tour.steps.length,
        updated_at: new Date().toISOString(),
        completed_at: null,
      },
    });
  }, [activeTourId, activeStep, progress, persist, stop, navigate, location.pathname]);

  const back = useCallback(() => {
    if (!activeTourId) return;
    setActiveStep((s) => Math.max(0, s - 1));
  }, [activeTourId]);

  const skip = useCallback(() => {
    if (!activeTourId) {
      stop();
      return;
    }
    const tour = TOURS[activeTourId];
    persist({
      ...progress,
      [activeTourId]: {
        status: "skipped",
        step: activeStep,
        total: tour.steps.length,
        updated_at: new Date().toISOString(),
        completed_at: null,
      },
    });
    stop();
  }, [activeTourId, activeStep, progress, persist, stop]);

  // Auto-start on first visit
  useEffect(() => {
    if (!profile || activeTourId) return;
    if (!(profile as any).meet_duncan_tour_completed_at) return; // wait for meet tour
    const tourId = AUTOSTART_MATCHERS.find((m) => m.test(location.pathname))?.tour;
    if (!tourId) return;
    if (autoStartedRef.current.has(tourId)) return;
    const p = progress[tourId];
    if (p && p.status !== "not_started") return; // already touched
    autoStartedRef.current.add(tourId);
    // small delay so page can render
    const t = setTimeout(() => start(tourId), 600);
    return () => clearTimeout(t);
  }, [location.pathname, profile, progress, activeTourId, start]);

  const value: Ctx = { activeTourId, activeStep, progress, start, stop, next, back, skip };

  const activeTour = activeTourId ? TOURS[activeTourId] : null;
  const step = activeTour?.steps[activeStep];

  return (
    <TourCtx.Provider value={value}>
      {children}
      {activeTour && step && (
        <TourOverlay
          step={step}
          index={activeStep}
          total={activeTour.steps.length}
          onNext={next}
          onBack={back}
          onSkip={skip}
        />
      )}
    </TourCtx.Provider>
  );
}
