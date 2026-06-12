import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { X, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";

type Nudge = {
  id: string;
  title: string;
  body: string;
  cta: { label: string; to: string };
  shouldShow: boolean;
};

export function AdoptionNudges() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile } = useProfile();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["adoption-signals", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [chats, projects, cards, kb] = await Promise.all([
        supabase.from("general_chats").select("id", { count: "exact", head: true }).eq("user_id", user!.id),
        supabase.from("projects").select("id", { count: "exact", head: true }),
        supabase.from("workstream_cards").select("id", { count: "exact", head: true }),
        supabase.from("kb_documents").select("id", { count: "exact", head: true }),
      ]);
      return {
        chats: chats.count ?? 0,
        projects: projects.count ?? 0,
        cards: cards.count ?? 0,
        kb: kb.count ?? 0,
      };
    },
  });

  if (!data || !profile?.onboarding_completed_at) return null;

  const daysSince = Math.floor(
    (Date.now() - new Date(profile.onboarding_completed_at).getTime()) / 86_400_000
  );
  // Only nudge in the first week
  if (daysSince > 7) return null;

  const dismissed = (profile.dismissed_nudges as string[] | undefined) ?? [];

  const nudges: Nudge[] = [
    {
      id: "nudge_projects",
      title: "Try Projects",
      body: "You've started chatting. Projects are where goals, milestones, and ownership live.",
      cta: { label: "Open Projects", to: "/projects" },
      shouldShow: data.chats >= 3 && data.projects === 0,
    },
    {
      id: "nudge_kb",
      title: "Feed the Knowledge Base",
      body: "Add your first document so Duncan can answer from your organisation's knowledge.",
      cta: { label: "Open Knowledge Base", to: "/knowledge-base" },
      shouldShow: daysSince >= 3 && data.kb === 0,
    },
    {
      id: "nudge_workstreams",
      title: "Track work in Workstreams",
      body: "Workstreams are the execution layer for ongoing operational work.",
      cta: { label: "Open Workstreams", to: "/workstreams" },
      shouldShow: daysSince >= 3 && data.cards === 0,
    },
  ];

  const visible = nudges.filter((n) => n.shouldShow && !dismissed.includes(n.id));
  if (visible.length === 0) return null;

  const dismiss = async (id: string) => {
    if (!user) return;
    const next = [...dismissed, id];
    await supabase.from("profiles").update({ dismissed_nudges: next } as any).eq("user_id", user.id);
    queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
  };

  return (
    <div className="space-y-2">
      {visible.map((n) => (
        <div
          key={n.id}
          className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 flex items-start gap-3"
        >
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-foreground">{n.title}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{n.body}</div>
            <button
              onClick={() => navigate(n.cta.to)}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
            >
              {n.cta.label} <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <button
            onClick={() => dismiss(n.id)}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
