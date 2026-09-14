import { useState } from "react";
import { UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProjectMember } from "@/hooks/useProjects";
import type { UserProfile } from "@/hooks/useWorkstreams";
import { initials } from "./shared";

export function ProjectTeamTab({
  members, availableProfiles, onAdd, onRemove, canManage,
}: {
  members: ProjectMember[];
  availableProfiles: UserProfile[];
  onAdd: (userId: string) => Promise<boolean> | void;
  onRemove: (userId: string) => Promise<boolean> | void;
  canManage: boolean;
}) {
  const [selected, setSelected] = useState("");

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Team</h2>
        <p className="text-sm text-muted-foreground">The people working on this project.</p>
      </div>

      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {members.map((m) => (
          <li key={m.user_id} className="group flex items-center gap-4 px-5 py-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
              {initials(m.display_name)}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{m.display_name || "Unnamed"}</p>
              <p className="text-xs text-muted-foreground truncate">{m.isOwner ? "Project Lead" : m.role_title || "Team member"}</p>
            </div>
            {canManage && !m.isOwner && (
              <button
                onClick={() => onRemove(m.user_id)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition"
                aria-label="Remove from project"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {canManage && (
        <div className="flex items-center gap-3">
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="max-w-xs"><SelectValue placeholder="Add someone to the project" /></SelectTrigger>
            <SelectContent>
              {availableProfiles.map((p) => (
                <SelectItem key={p.user_id} value={p.user_id}>{p.display_name || "Unnamed"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={!selected}
            onClick={async () => { await onAdd(selected); setSelected(""); }}
          >
            <UserPlus className="h-4 w-4" />
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
