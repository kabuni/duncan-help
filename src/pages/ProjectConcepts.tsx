import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Layers, Link2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { StatusDot, formatDay, initials } from "@/components/projects/workspace/shared";
import { RYG_META } from "@/hooks/useProjectWork";

/**
 * Read-only concept comparison. Shows how an existing Workstream Card could be
 * PROMOTED into a Project (card stays canonical, nothing duplicated) versus
 * creating a separate Project and linking cards to it.
 *
 * This page never writes to the database.
 */

interface CardPreview {
  id: string;
  task_code: string;
  title: string;
  description: string;
  status: string;
  due_date: string | null;
  owner_name: string | null;
  tasks: { id: string; title: string; completed: boolean; assignee_name: string | null; due_date: string | null }[];
}

function useCandidateCards() {
  return useQuery({
    queryKey: ["concept-candidate-cards"],
    queryFn: async (): Promise<CardPreview[]> => {
      const { data: cards, error } = await supabase
        .from("workstream_cards")
        .select("id, task_code, title, description, status, due_date, owner_id, project_id")
        .is("project_id", null)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      const ids = (cards || []).map((c) => c.id);
      const { data: tasks } = await supabase
        .from("workstream_tasks")
        .select("id, card_id, title, completed, assignee_id, due_date")
        .in("card_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
        .order("sort_order", { ascending: true });
      const people = [
        ...new Set([
          ...(cards || []).map((c) => c.owner_id),
          ...(tasks || []).map((t) => t.assignee_id),
        ].filter(Boolean) as string[]),
      ];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", people.length ? people : ["00000000-0000-0000-0000-000000000000"]);
      const nameOf = new Map((profiles || []).map((p: any) => [p.user_id, p.display_name as string]));
      return (cards || []).map((c: any) => ({
        id: c.id,
        task_code: c.task_code,
        title: c.title,
        description: c.description || "",
        status: c.status,
        due_date: c.due_date,
        owner_name: c.owner_id ? nameOf.get(c.owner_id) ?? null : null,
        tasks: (tasks || [])
          .filter((t: any) => t.card_id === c.id)
          .slice(0, 5)
          .map((t: any) => ({
            id: t.id,
            title: t.title,
            completed: t.completed,
            assignee_name: t.assignee_id ? nameOf.get(t.assignee_id) ?? null : null,
            due_date: t.due_date,
          })),
      }));
    },
  });
}

function CardChip({ card }: { card: CardPreview }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground truncate">{card.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">{card.task_code}</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
          <StatusDot status={card.status} />
          {RYG_META[card.status]?.label ?? card.status}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {[card.owner_name, card.due_date ? `Due ${formatDay(card.due_date)}` : null, `${card.tasks.length} tasks shown`]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  );
}

function TaskLines({ card }: { card: CardPreview }) {
  if (card.tasks.length === 0) return <p className="text-sm text-muted-foreground">No tasks on this card.</p>;
  return (
    <ul className="space-y-2">
      {card.tasks.map((t) => (
        <li key={t.id} className="flex items-center gap-3 text-sm">
          <span
            className={`h-3.5 w-3.5 rounded-[4px] border ${t.completed ? "bg-primary border-primary" : "border-muted-foreground/40"}`}
          />
          <span className={t.completed ? "line-through text-muted-foreground" : "text-foreground"}>{t.title}</span>
          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {t.assignee_name && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-[9px]">
                {initials(t.assignee_name)}
              </span>
            )}
            {t.due_date && formatDay(t.due_date)}
            <span className="font-mono">{card.task_code}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function ProjectConcepts() {
  const { data: cards = [], isLoading } = useCandidateCards();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const card = cards.find((c) => c.id === selectedId) || cards[0];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <header className="border-b border-border px-6 py-4">
        <Link to="/projects" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Projects
        </Link>
        <h1 className="mt-2 text-xl font-bold text-foreground">Workstream card as a project — concept</h1>
        <p className="text-sm text-muted-foreground">
          A read-only preview. Nothing on this page changes any data.
        </p>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8 space-y-10">
        <section className="space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Pick a real workstream card to preview
          </p>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {cards.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    card?.id === c.id
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="font-mono mr-1.5">{c.task_code}</span>
                  {c.title}
                </button>
              ))}
            </div>
          )}
        </section>

        {card && (
          <>
            {/* Option A */}
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-base font-semibold text-foreground">Option A — promote this card to a project</h2>
              </div>
              <p className="text-sm text-muted-foreground max-w-2xl">
                The card stays exactly as it is and becomes the first workstream of a new project. Its ID, owner,
                status, due date and tasks are not copied — the project simply shows them.
              </p>

              <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <CardChip card={card} />
                <ArrowRight className="hidden sm:block h-4 w-4 mx-auto text-muted-foreground" />
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Project</p>
                  <p className="font-medium text-foreground">{card.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[card.owner_name, card.due_date ? `Due ${formatDay(card.due_date)}` : "No target date"]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card">
                <div className="border-b border-border px-5 py-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Workstreams</p>
                </div>
                <div className="px-5 py-4 space-y-4">
                  <div className="flex items-center gap-3">
                    <Layers className="h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{card.title}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">{card.task_code}</span> · same card, still on the Workstreams board
                      </p>
                    </div>
                    <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                      <StatusDot status={card.status} />
                      {RYG_META[card.status]?.label ?? card.status}
                    </span>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-4">
                    <p className="mb-3 text-[11px] uppercase tracking-wider text-muted-foreground">
                      Tasks (unchanged, shown in both places)
                    </p>
                    <TaskLines card={card} />
                  </div>
                </div>
              </div>
            </section>

            {/* Option B */}
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-primary" />
                <h2 className="text-base font-semibold text-foreground">Option B — new project, link cards to it</h2>
              </div>
              <p className="text-sm text-muted-foreground max-w-2xl">
                You name the project yourself and give it its own description and target date, then attach this card
                alongside others. Same end result, one extra step at the start.
              </p>

              <div className="rounded-xl border border-border bg-card">
                <div className="border-b border-border px-5 py-3">
                  <p className="font-medium text-foreground">Your project name</p>
                  <p className="text-xs text-muted-foreground">Own description, owner and target date</p>
                </div>
                <div className="divide-y divide-border">
                  <div className="flex items-center gap-3 px-5 py-3">
                    <Layers className="h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">{card.title}</p>
                      <p className="text-xs text-muted-foreground font-mono">{card.task_code}</p>
                    </div>
                    <span className="ml-auto text-xs text-muted-foreground">linked</span>
                  </div>
                  <div className="flex items-center gap-3 px-5 py-3 text-muted-foreground">
                    <Layers className="h-4 w-4" />
                    <p className="text-sm">Another existing card…</p>
                    <span className="ml-auto text-xs">link or create</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-muted/30 p-5 space-y-2">
              <p className="text-sm font-medium text-foreground">What stays the same either way</p>
              <ul className="text-sm text-muted-foreground space-y-1.5">
                <li>• The card keeps its ID ({card.task_code}), owner, due date and RYG status.</li>
                <li>• Its tasks stay on the card — one task, shown in both the project and the workstream.</li>
                <li>• The Workstreams board is unaffected; a card can be unlinked from a project at any time.</li>
                <li>• Nothing is copied, so the two views can never disagree.</li>
              </ul>
            </section>

            <div className="flex justify-end">
              <Button asChild variant="outline">
                <Link to="/projects">Back to Projects</Link>
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
