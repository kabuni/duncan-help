import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FolderKanban, Loader2, ArrowUpRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePromoteCardToProject } from "@/hooks/useProjectWork";

interface Props {
  cardId: string;
  projectId: string | null;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  status?: string | null;
}

/**
 * Shortcut on an existing Workstream Card:
 *  - not in a project → "Promote to Project" creates the project shell and links
 *    this same card as its first workstream (nothing is duplicated).
 *  - already in a project → a quiet link through to that project workspace.
 */
export default function PromoteToProjectAction({ cardId, projectId, title, description, dueDate, status }: Props) {
  const navigate = useNavigate();
  const promote = usePromoteCardToProject();

  const { data: project } = useQuery({
    queryKey: ["card-project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name").eq("id", projectId!).maybeSingle();
      return data as { id: string; name: string } | null;
    },
  });

  if (projectId) {
    return (
      <button
        type="button"
        onClick={() => navigate(`/projects/${projectId}`)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
        title="Open the project this workstream belongs to"
      >
        <FolderKanban className="h-3 w-3" />
        <span className="max-w-[12rem] truncate">{project?.name || "Project"}</span>
        <ArrowUpRight className="h-3 w-3" />
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={promote.isPending}
      onClick={() =>
        promote.mutate(
          { cardId, title, description: description || "", dueDate: dueDate || null, status: status || null },
          { onSuccess: (p: any) => navigate(`/projects/${p.id}`) },
        )
      }
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50"
      title="Create a project around this workstream — the card stays exactly as it is"
    >
      {promote.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderKanban className="h-3 w-3" />}
      Promote to Project
    </button>
  );
}
