import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Link2, Loader2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useProjectWorkstreams, useLinkableWorkstreams, useLinkWorkstream, useUnlinkWorkstream, useCreateProjectWorkstream, RYG_META,
} from "@/hooks/useProjectWork";
import type { ProjectMember } from "@/hooks/useProjects";
import { taskCodeHref } from "@/components/TaskIdLink";
import { StatusDot, formatDay, EmptyLine } from "./shared";
import { WorkstreamProgressBar } from "./ProjectProgressRing";

export function ProjectWorkstreamsTab({ projectId, members }: { projectId: string; members: ProjectMember[] }) {
  const navigate = useNavigate();
  const { data: workstreams = [], isLoading } = useProjectWorkstreams(projectId);
  const [open, setOpen] = useState(false);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Areas of work</h2>
          <p className="text-sm text-muted-foreground">
            The parts of this project people are working on. Each area keeps its own tasks and status.
          </p>
        </div>
        <Button size="sm" className="gap-2 shrink-0" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          Add area of work
        </Button>
      </div>

      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : workstreams.length === 0 ? (
        <EmptyLine>No areas of work yet. Add one, or connect an area that already exists.</EmptyLine>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {workstreams.map((ws) => (
            <li key={ws.id} className="group">
              <button
                onClick={() => navigate(taskCodeHref(ws.task_code))}
                className="w-full text-left px-5 py-4 hover:bg-secondary/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <StatusDot status={ws.status} />
                  <span className="font-medium text-foreground truncate">{ws.title}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">{ws.task_code}</span>
                </div>
                {ws.description && (
                  <p className="mt-1 ml-5 text-sm text-muted-foreground line-clamp-1">{ws.description}</p>
                )}
                <div className="mt-2 ml-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{ws.owner_name || "No owner"}</span>
                  <span>{RYG_META[ws.status]?.label}</span>
                  {ws.due_date && <span>Due {formatDay(ws.due_date)}</span>}
                </div>
                {ws.tasks_total > 0 && <WorkstreamProgressBar done={ws.tasks_done} total={ws.tasks_total} />}
              </button>
            </li>
          ))}
        </ul>
      )}

      <AddWorkstreamDialog open={open} onOpenChange={setOpen} projectId={projectId} members={members} />
    </div>
  );
}

function AddWorkstreamDialog({
  open, onOpenChange, projectId, members,
}: { open: boolean; onOpenChange: (v: boolean) => void; projectId: string; members: ProjectMember[] }) {
  const { data: candidates = [] } = useLinkableWorkstreams();
  const link = useLinkWorkstream(projectId);
  const create = useCreateProjectWorkstream(projectId);
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState<string>("");
  const [dueDate, setDueDate] = useState("");

  const unlinked = candidates.filter(
    (c) => c.project_id !== projectId &&
      (search.trim() === "" || `${c.title} ${c.task_code}`.toLowerCase().includes(search.toLowerCase())),
  );

  const handleCreate = async () => {
    if (!title.trim()) return;
    await create.mutateAsync({ title: title.trim(), description: description.trim(), owner_id: ownerId || null, due_date: dueDate || null });
    setTitle(""); setDescription(""); setOwnerId(""); setDueDate("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a workstream</DialogTitle>
          <DialogDescription>Link an existing Workstream Card, or create a new one already attached to this project.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="link">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="link">Link existing</TabsTrigger>
            <TabsTrigger value="create">Create new</TabsTrigger>
          </TabsList>

          <TabsContent value="link" className="space-y-3 pt-3">
            <Input placeholder="Search workstream cards…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="max-h-64 overflow-y-auto divide-y divide-border rounded-lg border border-border">
              {unlinked.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No matching cards.</p>
              ) : unlinked.slice(0, 40).map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-3 py-2">
                  <StatusDot status={c.status} />
                  <span className="flex-1 min-w-0 truncate text-sm">{c.title}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">{c.task_code}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={link.isPending}
                    onClick={async () => { await link.mutateAsync(c.id); onOpenChange(false); }}
                  >
                    {c.project_id ? <Unlink className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                    {c.project_id ? "Move here" : "Link"}
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="create" className="space-y-3 pt-3">
            <Input placeholder="Workstream title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea placeholder="Short description (optional)" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger><SelectValue placeholder="Owner" /></SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>{m.display_name || "Unnamed"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={!title.trim() || create.isPending}>
                {create.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Create workstream
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
