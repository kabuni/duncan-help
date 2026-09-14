import { useState } from "react";
import { Plus, Loader2, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useProjects } from "@/hooks/useProjects";
import { useProjectSummaries, PROJECT_STATUS_META } from "@/hooks/useProjectWork";
import { useUserProfiles } from "@/hooks/useWorkstreams";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TutorialButton } from "@/components/onboarding/TutorialButton";
import { formatDay, initials } from "@/components/projects/workspace/shared";
import { ProductionStructurePreview } from "@/components/projects/ProductionStructurePreview";

export default function Projects() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { projects, loading, createProject, deleteProject } = useProjects();
  const { data: profiles = [] } = useUserProfiles({ approvedOnly: false });
  const { data: summaries = {} } = useProjectSummaries(
    projects.map((p) => p.id),
    projects.map((p) => p.user_id),
  );

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newTargetDate, setNewTargetDate] = useState("");
  const [newMembers, setNewMembers] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const nameFor = (userId: string) => profiles.find((p) => p.user_id === userId)?.display_name || "—";

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const project = await createProject(newName.trim(), {
      description: newDescription.trim() || null,
      target_date: newTargetDate || null,
    });
    if (project && newMembers.length > 0 && user) {
      await supabase.from("project_members").insert(
        newMembers.map((uid) => ({ project_id: project.id, user_id: uid, added_by: user.id })) as any,
      );
    }
    setCreating(false);
    if (project) {
      setShowCreate(false);
      setNewName(""); setNewDescription(""); setNewTargetDate(""); setNewMembers([]);
      navigate(`/projects/${project.id}`);
    }
  };

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <main className="flex-1 flex flex-col min-h-0">
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5 shrink-0">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Projects</h1>
            <p className="text-sm text-muted-foreground">Workspaces for the projects you're actively working on.</p>
          </div>
          <div className="flex items-center gap-2">
            <TutorialButton tourId="projects" />
            <Button data-tour="projects-new" onClick={() => setShowCreate(true)} size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              New Project
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-6 py-8">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : projects.length === 0 ? (
              <div className="py-20 text-center space-y-3">
                <h2 className="text-base font-semibold text-foreground">No projects yet</h2>
                <p className="text-sm text-muted-foreground">
                  A project brings the workstreams, tasks and people for one initiative into a single place.
                </p>
                <Button onClick={() => setShowCreate(true)} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Create your first project
                </Button>
              </div>
            ) : (
              <ul data-tour="projects-list" className="divide-y divide-border rounded-xl border border-border bg-card">
                {projects.map((project) => {
                  const s = summaries[project.id];
                  const status = PROJECT_STATUS_META[project.status] || PROJECT_STATUS_META.on_track;
                  return (
                    <li key={project.id} className="group">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => navigate(`/projects/${project.id}`)}
                        onKeyDown={(e) => { if (e.key === "Enter") navigate(`/projects/${project.id}`); }}
                        className="flex items-start gap-4 px-6 py-5 hover:bg-secondary/40 transition-colors cursor-pointer"
                      >
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2.5">
                            <span className={`inline-block h-2 w-2 rounded-full ${status.dot}`} />
                            <h3 className="font-medium text-foreground truncate">{project.name}</h3>
                          </div>
                          {project.description && (
                            <p className="text-sm text-muted-foreground line-clamp-1">{project.description}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className={status.text}>{status.label}</span>
                            <span className="inline-flex items-center gap-1.5">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-[9px] font-medium">
                                {initials(nameFor(project.user_id))}
                              </span>
                              {nameFor(project.user_id)}
                            </span>
                            <span>{s?.workstreams ?? 0} workstream{(s?.workstreams ?? 0) === 1 ? "" : "s"}</span>
                            <span>{s?.openTasks ?? 0} open task{(s?.openTasks ?? 0) === 1 ? "" : "s"}</span>
                            {project.target_date && <span>Due {formatDay(project.target_date)}</span>}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm("Delete this project? This cannot be undone.")) deleteProject(project.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition"
                          aria-label="Delete project"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <ProductionStructurePreview />
          </div>
        </div>
      </main>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>You can connect workstreams once the project is open.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Input placeholder="Project name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Textarea
              placeholder="What is this project about?"
              rows={3}
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center rounded-md border border-border px-3 text-xs text-muted-foreground">
                Owner: {nameFor(user?.id || "")}
              </div>
              <Input type="date" value={newTargetDate} onChange={(e) => setNewTargetDate(e.target.value)} />
            </div>
            <Select
              value=""
              onValueChange={(v) => setNewMembers((prev) => (prev.includes(v) ? prev : [...prev, v]))}
            >
              <SelectTrigger><SelectValue placeholder="Add team members (optional)" /></SelectTrigger>
              <SelectContent>
                {profiles
                  .filter((p) => p.user_id !== user?.id && !newMembers.includes(p.user_id))
                  .map((p) => <SelectItem key={p.user_id} value={p.user_id}>{p.display_name || "Unnamed"}</SelectItem>)}
              </SelectContent>
            </Select>
            {newMembers.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {newMembers.map((uid) => (
                  <button
                    key={uid}
                    onClick={() => setNewMembers((prev) => prev.filter((m) => m !== uid))}
                    className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground hover:bg-secondary/70"
                  >
                    {nameFor(uid)} ×
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
              {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
