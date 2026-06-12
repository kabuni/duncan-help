import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, PlayCircle } from "lucide-react";
import { MODULES } from "@/components/onboarding/moduleContent";
import MeetDuncanTour from "@/components/onboarding/MeetDuncanTour";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";

export default function Learn() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tourOpen, setTourOpen] = useState(false);

  const replay = async () => {
    if (user) {
      await supabase
        .from("profiles")
        .update({ meet_duncan_tour_completed_at: null } as any)
        .eq("user_id", user.id);
      queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
    }
    setTourOpen(true);
  };

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-8 py-8 sm:py-12">
        <div className="mb-8 sm:mb-10">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">
            Learn Duncan
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight mb-2">
            A quick guide to how everything fits together.
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Duncan is a connected operating system, not a collection of separate tools.
            Here's what each module does and when to use it.
          </p>
          <button
            onClick={replay}
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-3.5 py-2 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
          >
            <PlayCircle className="h-3.5 w-3.5" /> Replay Meet Duncan tour
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {MODULES.map((m) => {
            const Icon = m.icon;
            return (
              <div
                key={m.id}
                className="rounded-xl border border-border bg-card p-5 flex flex-col"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{m.title}</h3>
                    <p className="text-[11px] text-muted-foreground">{m.headline}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed flex-1">
                  {m.body}
                </p>
                {m.examples && m.examples.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {m.examples.map((ex) => (
                      <li
                        key={ex}
                        className="text-[11px] text-muted-foreground/90 pl-3 border-l-2 border-primary/30"
                      >
                        "{ex}"
                      </li>
                    ))}
                  </ul>
                )}
                {m.cta && (
                  <button
                    onClick={() => navigate(m.cta!.to)}
                    className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors self-start"
                  >
                    {m.cta.label} <ArrowRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-10 rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-2">
            How it works together
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Chat sits at the centre — your fastest way to get anything done. Projects give
            strategic visibility, Workstreams drive execution, the Knowledge Base is
            organisational memory, and Planner manages priorities. Profile and Integrations
            personalise the experience. Feature Requests and Bug Reports close the
            feedback loop so Duncan keeps getting better.
          </p>
        </div>
      </div>

      <MeetDuncanTour open={tourOpen} onClose={() => setTourOpen(false)} />
    </div>
  );
}
