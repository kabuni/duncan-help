import { PlayCircle } from "lucide-react";
import { useTour } from "@/components/onboarding/tour/TourProvider";
import { TOURS } from "@/components/onboarding/tour/tours";

export function TutorialButton({
  tourId,
  className = "",
  label,
}: {
  tourId: string;
  className?: string;
  label?: string;
}) {
  const { start, progress } = useTour();
  if (!TOURS[tourId]) return null;
  const p = progress[tourId];
  const text = label ?? (p?.status === "completed" || p?.status === "skipped" ? "Replay tour" : p?.status === "in_progress" ? "Resume tour" : "Start tour");
  return (
    <button
      onClick={() => start(tourId, { restart: p?.status === "completed" || p?.status === "skipped" })}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors ${className}`}
    >
      <PlayCircle className="h-3.5 w-3.5" /> {text}
    </button>
  );
}
