import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Check, Circle, X, PlayCircle, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useGmailStatus } from "@/hooks/useGmailIntegration";
import { useGoogleCalendar } from "@/hooks/useGoogleCalendar";
import { useEffect, useState } from "react";

const DISMISS_KEY = "getting_started_card";

type Item = {
  id: string;
  label: string;
  done: boolean;
  action?: () => void;
  actionLabel?: string;
};

export function GettingStartedCard({ onReplayTour }: { onReplayTour: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile } = useProfile();
  const queryClient = useQueryClient();
  const gmail = useGmailStatus();
  const { isConnected: calConnected, checkConnection } = useGoogleCalendar();

  useEffect(() => { checkConnection(); /* eslint-disable-next-line */ }, []);

  const { data: signals } = useQuery({
    queryKey: ["getting-started-signals", user?.id],
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

  const dismissed = (profile?.dismissed_nudges as string[] | undefined)?.includes(DISMISS_KEY);

  const items: Item[] = [
    {
      id: "integrations",
      label: "Connect Gmail & Calendar",
      done: !!gmail.data?.connected && !gmail.data?.expired && calConnected === true,
      action: () => navigate("/integrations"),
      actionLabel: "Connect",
    },
    {
      id: "personalize",
      label: "Personalise Duncan",
      done: !!profile?.bio || !!profile?.norman_context,
      action: () => navigate("/settings"),
      actionLabel: "Open",
    },
    {
      id: "first-chat",
      label: "Send your first chat message",
      done: (signals?.chats ?? 0) > 0,
      action: () => navigate("/"),
      actionLabel: "Open Chat",
    },
    {
      id: "first-project",
      label: "Create or open a Project",
      done: (signals?.projects ?? 0) > 0,
      action: () => navigate("/projects"),
      actionLabel: "Open",
    },
    {
      id: "first-workstream",
      label: "Open a Workstream",
      done: (signals?.cards ?? 0) > 0,
      action: () => navigate("/workstreams"),
      actionLabel: "Open",
    },
    {
      id: "first-kb",
      label: "Add a document to the Knowledge Base",
      done: (signals?.kb ?? 0) > 0,
      action: () => navigate("/knowledge-base"),
      actionLabel: "Open",
    },
    {
      id: "planner",
      label: "Review your Planner",
      done: false,
      action: () => navigate("/diary"),
      actionLabel: "Open",
    },
  ];

  const completed = items.filter((i) => i.done).length;
  const total = items.length;
  const allDone = completed === total;

  if (dismissed) return null;

  const dismiss = async () => {
    if (!user) return;
    const next = [...((profile?.dismissed_nudges as string[] | undefined) ?? []), DISMISS_KEY];
    await supabase.from("profiles").update({ dismissed_nudges: next } as any).eq("user_id", user.id);
    queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Getting started with Duncan
          </div>
          <div className="text-sm font-semibold text-foreground mt-1">
            {allDone ? "You're all set." : `${completed} of ${total} complete`}
          </div>
        </div>
        <button
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 -m-1"
          aria-label="Dismiss"
          title="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="h-1 w-full bg-border rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${(completed / total) * 100}%` }}
        />
      </div>

      <ul className="space-y-1">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-2 py-1.5 px-1 -mx-1 rounded-md group"
          >
            {item.done ? (
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <Circle className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            )}
            <span
              className={`flex-1 text-xs ${
                item.done ? "text-muted-foreground line-through" : "text-foreground"
              }`}
            >
              {item.label}
            </span>
            {!item.done && item.action && (
              <button
                onClick={item.action}
                className="text-[10px] text-primary hover:text-primary/80 transition-colors opacity-0 group-hover:opacity-100 inline-flex items-center gap-0.5"
              >
                {item.actionLabel ?? "Open"} <ChevronRight className="h-2.5 w-2.5" />
              </button>
            )}
          </li>
        ))}
        <li className="flex items-center gap-2 py-1.5 border-t border-border/50 mt-2 pt-3">
          <PlayCircle className="h-3.5 w-3.5 text-primary shrink-0" />
          <button
            onClick={onReplayTour}
            className="flex-1 text-left text-xs text-foreground hover:text-primary transition-colors"
          >
            Replay the Meet Duncan tour
          </button>
        </li>
      </ul>
    </div>
  );
}
