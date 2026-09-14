import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import type { CardStatus } from "@/hooks/useWorkstreams";

/**
 * Project → Workstream → Task relationships.
 *
 * Workstream Cards remain the canonical company-wide tracker (workstream_cards).
 * A project simply *points at* cards via workstream_cards.project_id — nothing is
 * duplicated. Tasks are a single underlying object (workstream_tasks): they can
 * belong to a project, to a card, or to both.
 */

export interface ProjectWorkstream {
  id: string;
  task_code: string;
  title: string;
  description: string;
  status: CardStatus;
  priority: string;
  owner_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  tasks_total: number;
  tasks_done: number;
}

export interface ProjectTask {
  id: string;
  title: string;
  description: string;
  assignee_id: string | null;
  assignee_name: string | null;
  due_date: string | null;
  completed: boolean;
  status: CardStatus;
  project_id: string | null;
  card_id: string | null;
  workstream_title: string | null;
  workstream_code: string | null;
  created_at: string;
}

export interface ProjectActivityItem {
  id: string;
  created_at: string;
  actor: string | null;
  text: string;
}

async function profileMap(userIds: (string | null)[]) {
  const ids = [...new Set(userIds.filter(Boolean))] as string[];
  if (ids.length === 0) return new Map<string, string>();
  const { data } = await supabase
    .from("profiles")
    .select("user_id, display_name")
    .in("user_id", ids);
  return new Map((data || []).map((p: any) => [p.user_id, p.display_name as string]));
}

export function useProjectWorkstreams(projectId: string | null) {
  return useQuery({
    queryKey: ["project-workstreams", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectWorkstream[]> => {
      const { data, error } = await supabase
        .from("workstream_cards")
        .select("id, task_code, title, description, status, priority, owner_id, due_date, workstream_tasks(id, completed)")
        .eq("project_id", projectId!)
        .is("archived_at", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = (data || []) as any[];
      const names = await profileMap(rows.map((r) => r.owner_id));
      return rows.map((r) => ({
        id: r.id,
        task_code: r.task_code,
        title: r.title,
        description: r.description || "",
        status: r.status,
        priority: r.priority,
        owner_id: r.owner_id,
        owner_name: r.owner_id ? names.get(r.owner_id) ?? null : null,
        due_date: r.due_date,
        tasks_total: (r.workstream_tasks || []).length,
        tasks_done: (r.workstream_tasks || []).filter((t: any) => t.completed).length,
      }));
    },
  });
}

/** All tasks that belong to this project — directly, or via one of its workstream cards. */
export function useProjectTasks(projectId: string | null) {
  return useQuery({
    queryKey: ["project-tasks", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectTask[]> => {
      const { data: cards } = await supabase
        .from("workstream_cards")
        .select("id, title, task_code")
        .eq("project_id", projectId!);
      const cardRows = (cards || []) as any[];
      const cardIds = cardRows.map((c) => c.id);

      const queries: any[] = [
        supabase
          .from("workstream_tasks")
          .select("*")
          .eq("project_id", projectId!),
      ];
      if (cardIds.length > 0) {
        queries.push(supabase.from("workstream_tasks").select("*").in("card_id", cardIds));
      }
      const results = await Promise.all(queries);
      const seen = new Set<string>();
      const rows: any[] = [];
      for (const res of results) {
        for (const row of (res.data || []) as any[]) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          rows.push(row);
        }
      }

      const names = await profileMap(rows.map((r) => r.assignee_id));
      const cardMap = new Map(cardRows.map((c) => [c.id, c]));
      return rows
        .map((r) => {
          const card = r.card_id ? cardMap.get(r.card_id) : null;
          return {
            id: r.id,
            title: r.title,
            description: r.description || "",
            assignee_id: r.assignee_id,
            assignee_name: r.assignee_id ? names.get(r.assignee_id) ?? null : null,
            due_date: r.due_date,
            completed: r.completed,
            status: r.status,
            project_id: r.project_id,
            card_id: r.card_id,
            workstream_title: card?.title ?? null,
            workstream_code: card?.task_code ?? null,
            created_at: r.created_at,
          } as ProjectTask;
        })
        .sort((a, b) => {
          if (a.completed !== b.completed) return a.completed ? 1 : -1;
          if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
          if (a.due_date) return -1;
          if (b.due_date) return 1;
          return a.created_at.localeCompare(b.created_at);
        });
    },
  });
}

/** Workstream cards not yet attached to any project — candidates for linking. */
export function useLinkableWorkstreams() {
  return useQuery({
    queryKey: ["linkable-workstreams"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workstream_cards")
        .select("id, task_code, title, project_id, status")
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as Array<{ id: string; task_code: string; title: string; project_id: string | null; status: CardStatus }>;
    },
  });
}

function useInvalidateProject(projectId: string | null) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["project-workstreams", projectId] });
    qc.invalidateQueries({ queryKey: ["project-tasks", projectId] });
    qc.invalidateQueries({ queryKey: ["project-activity", projectId] });
    qc.invalidateQueries({ queryKey: ["linkable-workstreams"] });
    qc.invalidateQueries({ queryKey: ["project-summaries"] });
    qc.invalidateQueries({ queryKey: ["workstream-cards"] });
  };
}

export function useLinkWorkstream(projectId: string | null) {
  const invalidate = useInvalidateProject(projectId);
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (cardId: string) => {
      const { error } = await supabase
        .from("workstream_cards")
        .update({ project_id: projectId })
        .eq("id", cardId);
      if (error) throw error;
      if (user) {
        await supabase.from("workstream_activity").insert({
          card_id: cardId, user_id: user.id, action: "linked_to_project", details: { project_id: projectId },
        });
      }
    },
    onSuccess: () => { invalidate(); toast.success("Workstream linked to this project"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUnlinkWorkstream(projectId: string | null) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: async (cardId: string) => {
      const { error } = await supabase.from("workstream_cards").update({ project_id: null }).eq("id", cardId);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Workstream removed from this project (the card itself is untouched)"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

const CARD_TO_PROJECT_STATUS: Record<string, string> = {
  green: "on_track",
  amber: "at_risk",
  red: "off_track",
  done: "done",
};

/**
 * Shortcut: turn an existing Workstream Card into a Project.
 * Creates the project shell and points the same card at it — no data is copied,
 * the card keeps its WS ID, owner, due date, status and tasks.
 */
export function usePromoteCardToProject() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      cardId: string; title: string; description?: string; dueDate?: string | null; status?: string | null;
    }) => {
      if (!user) throw new Error("Not signed in");
      const { data: project, error } = await supabase
        .from("projects")
        .insert({
          user_id: user.id,
          name: input.title,
          description: input.description || null,
          target_date: input.dueDate || null,
          status: CARD_TO_PROJECT_STATUS[input.status || ""] || "on_track",
        } as any)
        .select("id, name")
        .single();
      if (error) throw error;

      const { error: linkError } = await supabase
        .from("workstream_cards")
        .update({ project_id: project.id })
        .eq("id", input.cardId);
      if (linkError) {
        await supabase.from("projects").delete().eq("id", project.id);
        throw linkError;
      }

      await supabase.from("workstream_activity").insert({
        card_id: input.cardId, user_id: user.id, action: "linked_to_project", details: { project_id: project.id },
      });
      return project;
    },
    onSuccess: (project: any) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["workstream-cards"] });
      qc.invalidateQueries({ queryKey: ["linkable-workstreams"] });
      qc.invalidateQueries({ queryKey: ["card-project"] });
      toast.success(`Project "${project.name}" created — this workstream is its first workstream`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateProjectWorkstream(projectId: string | null) {
  const invalidate = useInvalidateProject(projectId);
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { title: string; description?: string; owner_id?: string | null; due_date?: string | null; priority?: string }) => {
      if (!user) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("workstream_cards")
        .insert({
          title: input.title,
          description: input.description || "",
          owner_id: input.owner_id || null,
          due_date: input.due_date || null,
          priority: input.priority || "medium",
          status: "not_started",
          created_by: user.id,
          project_id: projectId,
        } as any)
        .select("id, task_code")
        .single();
      if (error) throw error;
      await supabase.from("workstream_activity").insert({
        card_id: data.id, user_id: user.id, action: "card_created", details: { title: input.title },
      });
      return data;
    },
    onSuccess: (data: any) => { invalidate(); toast.success(`Workstream ${data.task_code} created`); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateProjectTask(projectId: string | null) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: async (input: {
      title: string; description?: string; assignee_id?: string | null; due_date?: string | null; card_id?: string | null;
    }) => {
      const { error } = await supabase.from("workstream_tasks").insert({
        title: input.title,
        description: input.description || "",
        assignee_id: input.assignee_id || null,
        due_date: input.due_date || null,
        card_id: input.card_id || null,
        project_id: projectId,
        status: "not_started",
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Task added"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useToggleProjectTask(projectId: string | null) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const { error } = await supabase
        .from("workstream_tasks")
        .update({ completed, status: completed ? "done" : "not_started" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateProjectTask(projectId: string | null) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; title?: string; description?: string; assignee_id?: string | null; due_date?: string | null }) => {
      const { error } = await supabase.from("workstream_tasks").update(patch as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteProjectTask(projectId: string | null) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("workstream_tasks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Task removed"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

const ACTION_LABELS: Record<string, string> = {
  card_created: "created workstream",
  linked_to_project: "linked workstream to the project",
  status_changed: "changed status of",
  task_created: "added task to",
  card_updated: "updated",
};

export function useProjectActivity(projectId: string | null) {
  return useQuery({
    queryKey: ["project-activity", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectActivityItem[]> => {
      const { data: cards } = await supabase
        .from("workstream_cards")
        .select("id, title, task_code")
        .eq("project_id", projectId!);
      const cardRows = (cards || []) as any[];
      if (cardRows.length === 0) return [];
      const cardMap = new Map(cardRows.map((c) => [c.id, c]));
      const { data } = await supabase
        .from("workstream_activity")
        .select("*")
        .in("card_id", cardRows.map((c) => c.id))
        .order("created_at", { ascending: false })
        .limit(40);
      const rows = (data || []) as any[];
      const names = await profileMap(rows.map((r) => r.user_id));
      return rows.map((r) => {
        const card = cardMap.get(r.card_id);
        const label = ACTION_LABELS[r.action] || r.action.replace(/_/g, " ");
        const detail = r.details?.title || card?.title || "";
        return {
          id: r.id,
          created_at: r.created_at,
          actor: names.get(r.user_id) ?? null,
          text: `${label} ${detail}${card?.task_code ? ` (${card.task_code})` : ""}`.trim(),
        };
      });
    },
  });
}

export interface ProjectSummary {
  workstreams: number;
  openTasks: number;
  ownerName: string | null;
}

/** Counts used by the Projects list, in one pass. */
export function useProjectSummaries(projectIds: string[], ownerIds: string[]) {
  const key = [...projectIds].sort().join(",");
  return useQuery({
    queryKey: ["project-summaries", key],
    enabled: projectIds.length > 0,
    queryFn: async (): Promise<Record<string, ProjectSummary>> => {
      const [{ data: cards }, { data: tasks }, names] = await Promise.all([
        supabase.from("workstream_cards").select("id, project_id").in("project_id", projectIds).is("archived_at", null),
        supabase.from("workstream_tasks").select("id, project_id, card_id, completed"),
        profileMap(ownerIds),
      ]);
      const cardRows = (cards || []) as any[];
      const cardProject = new Map(cardRows.map((c) => [c.id, c.project_id]));
      const out: Record<string, ProjectSummary> = {};
      for (const pid of projectIds) out[pid] = { workstreams: 0, openTasks: 0, ownerName: null };
      for (const c of cardRows) if (out[c.project_id]) out[c.project_id].workstreams += 1;
      for (const t of (tasks || []) as any[]) {
        if (t.completed) continue;
        const pid = t.project_id || (t.card_id ? cardProject.get(t.card_id) : null);
        if (pid && out[pid]) out[pid].openTasks += 1;
      }
      return Object.fromEntries(
        Object.entries(out).map(([pid, v]) => [pid, { ...v, ownerName: v.ownerName }]),
      ) as Record<string, ProjectSummary>;
    },
  });
}

export const PROJECT_STATUS_META: Record<string, { label: string; dot: string; text: string }> = {
  on_track: { label: "On track", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  at_risk: { label: "At risk", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  off_track: { label: "Off track", dot: "bg-destructive", text: "text-destructive" },
  done: { label: "Complete", dot: "bg-muted-foreground", text: "text-muted-foreground" },
};

export const RYG_META: Record<string, { label: string; dot: string }> = {
  not_started: { label: "Not started", dot: "bg-muted-foreground/50" },
  red: { label: "Red", dot: "bg-destructive" },
  amber: { label: "Amber", dot: "bg-amber-500" },
  green: { label: "Green", dot: "bg-emerald-500" },
  done: { label: "Done", dot: "bg-primary" },
};
