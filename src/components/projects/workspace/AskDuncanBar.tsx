import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProjectMember } from "@/hooks/useProjects";
import type { ProjectWorkstream } from "@/hooks/useProjectWork";
import { useCreateProjectTask } from "@/hooks/useProjectWork";
import { formatDay } from "./shared";

interface Understanding {
  title: string;
  assignee: ProjectMember | null;
  workstream: ProjectWorkstream | null;
  dueDate: string | null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function parseDue(text: string): { date: string | null; matched: string | null } {
  const lower = text.toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (/\btoday\b/.test(lower)) return { date: isoDate(today), matched: "today" };
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(today); d.setDate(d.getDate() + 1);
    return { date: isoDate(d), matched: "tomorrow" };
  }
  const weekday = lower.match(/\b(?:by|on|before|due)?\s*(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2]);
    const d = new Date(today);
    let delta = (target - d.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    if (weekday[1]) delta += 7;
    d.setDate(d.getDate() + delta);
    return { date: isoDate(d), matched: weekday[0].trim() };
  }
  const dm = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  if (dm) {
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(dm[2]);
    const d = new Date(today.getFullYear(), month, parseInt(dm[1], 10));
    if (d < today) d.setFullYear(d.getFullYear() + 1);
    return { date: isoDate(d), matched: dm[0] };
  }
  return { date: null, matched: null };
}

function interpret(text: string, members: ProjectMember[], workstreams: ProjectWorkstream[]): Understanding | null {
  const raw = text.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  const assignee =
    members.find((m) => {
      const name = (m.display_name || "").trim();
      if (!name) return false;
      const first = name.split(" ")[0].toLowerCase();
      return lower.includes(name.toLowerCase()) || (first.length > 2 && new RegExp(`\\b${first}\\b`).test(lower));
    }) || null;

  const workstream =
    workstreams.find((w) => lower.includes(w.task_code.toLowerCase()) || lower.includes(w.title.toLowerCase())) ||
    workstreams.find((w) =>
      w.title
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 4)
        .some((word) => lower.includes(word)),
    ) || null;

  const { date, matched } = parseDue(raw);

  let title = raw
    .replace(/^\s*(hey\s+)?duncan[,:]?\s*/i, "")
    .replace(/^\s*(please\s+)?(can you\s+)?(add|create|make|set up)\s+(a\s+)?(task|to-?do)?\s*/i, "")
    .replace(/\bfor\s+[A-Z][a-z]+\b/g, "")
    .replace(/\b(assigned to|assign to|for)\s+[a-z]+\b/gi, "");
  if (assignee?.display_name) {
    const first = assignee.display_name.split(" ")[0];
    title = title.replace(new RegExp(`\\b${first}\\b`, "gi"), "");
  }
  if (matched) title = title.replace(new RegExp(matched.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "");
  title = title
    .replace(/\b(by|on|before|due)\b\s*$/i, "")
    .replace(/^\s*to\s+/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[,\s]+$/, "")
    .trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);

  if (!title) return null;
  return { title, assignee, workstream, dueDate: date };
}

/**
 * Subtle "Ask Duncan" entry point inside a project. Duncan reads the request in
 * the project's context and proposes the task with its project, workstream,
 * assignee and date already resolved — the user just confirms.
 */
export function AskDuncanBar({
  projectId, projectName, members, workstreams,
}: { projectId: string; projectName: string; members: ProjectMember[]; workstreams: ProjectWorkstream[] }) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Understanding | null>(null);
  const createTask = useCreateProjectTask(projectId);

  const handleAsk = () => {
    const result = interpret(text, members, workstreams);
    setDraft(result);
  };

  const confirm = async () => {
    if (!draft) return;
    await createTask.mutateAsync({
      title: draft.title,
      assignee_id: draft.assignee?.user_id || null,
      due_date: draft.dueDate,
      card_id: draft.workstream?.id || null,
    });
    setDraft(null);
    setText("");
  };

  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary shrink-0" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAsk(); } }}
          placeholder='Ask Duncan — e.g. "Add a task for Sarah to review the homepage by Friday"'
          className="border-0 bg-transparent shadow-none focus-visible:ring-0 px-0 text-sm"
        />
        <Button size="sm" variant="outline" onClick={handleAsk} disabled={!text.trim()}>Ask</Button>
      </div>

      {draft && (
        <div className="mt-3 rounded-lg border border-border bg-card p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-muted-foreground">Duncan understood this as:</p>
            <button onClick={() => setDraft(null)} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <dl className="mt-2 grid grid-cols-[110px_1fr] gap-y-1.5">
            <dt className="text-xs text-muted-foreground">Project</dt>
            <dd className="text-sm text-foreground">{projectName}</dd>
            <dt className="text-xs text-muted-foreground">Workstream</dt>
            <dd className="text-sm text-foreground">
              {draft.workstream ? `${draft.workstream.title} · ${draft.workstream.task_code}` : "None — project task"}
            </dd>
            <dt className="text-xs text-muted-foreground">Task</dt>
            <dd className="text-sm text-foreground">{draft.title}</dd>
            <dt className="text-xs text-muted-foreground">Assignee</dt>
            <dd className="text-sm text-foreground">{draft.assignee?.display_name || "Unassigned"}</dd>
            <dt className="text-xs text-muted-foreground">Due</dt>
            <dd className="text-sm text-foreground">{draft.dueDate ? formatDay(draft.dueDate) : "No date"}</dd>
          </dl>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            <Button size="sm" onClick={confirm} disabled={createTask.isPending}>Create task</Button>
          </div>
        </div>
      )}
      {text.trim() && !draft && (
        <p className="mt-2 text-xs text-muted-foreground">
          Duncan works out the project, workstream, owner and date — you never have to choose where it belongs.
        </p>
      )}
    </div>
  );
}
