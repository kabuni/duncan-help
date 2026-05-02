import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Target, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { KeyEvent, KeyEventGoal } from "@/hooks/useKeyEvents";
import { cn } from "@/lib/utils";

interface GoalsPanelProps {
  goals: KeyEventGoal[];
  events: KeyEvent[];
  isAdmin: boolean;
  onChange: () => void;
  onSelectGoal: (g: KeyEventGoal) => void;
}

export function GoalsPanel({ goals, events, isAdmin, onChange, onSelectGoal }: GoalsPanelProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "", target_date: "" });
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!draft.name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("key_event_goals" as any).insert({
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      target_date: draft.target_date || null,
      sort_order: (goals.at(-1)?.sort_order ?? 0) + 1,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Goal added");
    setDraft({ name: "", description: "", target_date: "" });
    setAdding(false);
    onChange();
  }

  async function remove(g: KeyEventGoal, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete goal "${g.name}"?`)) return;
    const { error } = await supabase.from("key_event_goals" as any).delete().eq("id", g.id);
    if (error) { toast.error(error.message); return; }
    onChange();
  }

  return (
    <Card className="p-4 space-y-3 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold tracking-tight">Company goals</h2>
        </div>
        <Badge variant="outline" className="text-[10px]">{goals.length}</Badge>
      </div>

      <div className="space-y-1.5">
        {goals.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No goals yet.</p>
        )}
        {goals.map((g) => {
          const linked = events.filter((e) => e.linked_goal_ids.includes(g.id)).length;
          return (
            <button
              key={g.id}
              onClick={() => onSelectGoal(g)}
              className={cn(
                "w-full text-left border border-border rounded-md p-2.5 hover:border-primary/40 hover:bg-accent/40 transition-colors group",
                g.status !== "active" && "opacity-60"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground truncate">{g.name}</div>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                    {g.target_date && <span>{new Date(g.target_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
                    <span>· {linked} event{linked === 1 ? "" : "s"}</span>
                    {g.status !== "active" && <span>· {g.status}</span>}
                  </div>
                </div>
                {isAdmin && (
                  <button
                    onClick={(e) => remove(g, e)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                    aria-label="Delete goal"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {isAdmin && (
        <div className="border-t border-border pt-3">
          {!adding ? (
            <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add goal
            </Button>
          ) : (
            <div className="space-y-2">
              <Input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Goal name"
                className="h-8 text-sm"
              />
              <Input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Description (optional)"
                className="h-8 text-sm"
              />
              <Input
                type="date"
                value={draft.target_date}
                onChange={(e) => setDraft({ ...draft, target_date: e.target.value })}
                className="h-8 text-sm"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={add} disabled={saving || !draft.name.trim()} className="flex-1">
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setAdding(false); setDraft({ name: "", description: "", target_date: "" }); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
