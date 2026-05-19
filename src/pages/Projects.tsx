import { useState } from "react";
import { Plus, FolderOpen, Loader2, ArrowRight, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useProjects } from "@/hooks/useProjects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";

export default function Projects() {
  const navigate = useNavigate();
  const { projects, loading, createProject, deleteProject } = useProjects();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const project = await createProject(newName.trim(), newPrompt.trim() || undefined);
    setCreating(false);
    if (project) {
      setShowCreate(false);
      setNewName("");
      setNewPrompt("");
      navigate(`/projects/${project.id}`);
    }
  };

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <main className="flex-1 flex flex-col min-h-0">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold text-foreground">Projects</h1>
              <p className="text-xs text-muted-foreground">Isolated AI workspaces with persistent context</p>
            </div>
          </div>
          <Button onClick={() => setShowCreate(true)} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </header>


        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-4">
                <FolderOpen className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-1">No projects yet</h2>
              <p className="text-sm text-muted-foreground mb-4 max-w-sm">
                Create a project to start an isolated AI workspace with persistent chats, files, and custom instructions.
              </p>
              <Button onClick={() => setShowCreate(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Create your first project
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map(project => (
                <div
                  key={project.id}
                  className="group relative flex flex-col rounded-xl border border-border bg-card p-5 hover:border-primary/30 hover:shadow-md transition-all cursor-pointer"
                  onClick={() => navigate(`/projects/${project.id}`)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <FolderOpen className="h-5 w-5 text-primary" />
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); if (confirm("Delete this project? This cannot be undone.")) deleteProject(project.id); }}
                      className="opacity-0 group-hover:opacity-100 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <h3 className="font-semibold text-foreground mb-1 truncate">{project.name}</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    {project.system_prompt ? "Custom instructions set" : "Default instructions"}
                  </p>
                  <div className="mt-auto flex items-center justify-between">
                    <span className="text-[10px] font-mono text-muted-foreground/60">
                      {format(new Date(project.created_at), "MMM d, yyyy")}
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Project Name</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Q4 Strategy Analysis"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">
                Custom Instructions <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Textarea
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                placeholder="e.g. You are an expert financial analyst. Always provide data-backed insights..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
