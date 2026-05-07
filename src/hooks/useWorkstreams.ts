import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export type CardStatus = "not_started" | "red" | "amber" | "green" | "done";
export type CardPriority = "low" | "medium" | "high" | "critical";

export interface WorkstreamCard {
  id: string;
  title: string;
  description: string;
  status: CardStatus;
  priority: CardPriority;
  owner_id: string | null;
  due_date: string | null;
  project_tag: string | null;
  created_by: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  tasks_total?: number;
  tasks_completed?: number;
  owner_name?: string;
  assignees?: AssigneeInfo[];
  overall_status?: CardStatus;
  task_breakdown?: TaskBreakdown;
}

export interface TaskBreakdown {
  red: number;
  yellow: number;
  green: number;
  done: number;
  not_started: number;
}

/**
 * Computes a card's *overall* health from its tasks.
 * - No tasks            → "red"
 * - Any red task        → "red"
 * - Any amber task      → "amber" (treated as "yellow" in UI copy)
 * - All tasks done      → "done"
 * - Otherwise           → "green"
 *
 * Uses task.status as the source of truth. A task with completed=true
 * is normalized to "done" to handle inconsistent legacy rows.
 */
export function getOverallStatus(
  tasks: Array<{ status?: CardStatus | string | null; completed?: boolean }> | undefined | null
): CardStatus {
  if (!tasks || tasks.length === 0) return "not_started";

  let hasRed = false;
  let hasAmber = false;
  let hasActive = false; // any non not_started, non done
  let allDone = true;
  let allNotStarted = true;

  for (const t of tasks) {
    const raw = (t.completed ? "done" : (t.status || "not_started")) as string;
    const s: CardStatus = raw === "yellow" ? "amber" : (raw as CardStatus);
    if (s !== "done") allDone = false;
    if (s !== "not_started") allNotStarted = false;
    if (s !== "not_started" && s !== "done") hasActive = true;
    if (s === "red") hasRed = true;
    else if (s === "amber") hasAmber = true;
  }

  if (allNotStarted) return "not_started";
  if (hasRed) return "red";
  if (hasAmber) return "amber";
  if (allDone) return "done";
  if (hasActive) return "green";
  return "not_started";
}

export function getTaskBreakdown(
  tasks: Array<{ status?: CardStatus | string | null; completed?: boolean }> | undefined | null
): TaskBreakdown {
  const out: TaskBreakdown = { red: 0, yellow: 0, green: 0, done: 0, not_started: 0 };
  if (!tasks) return out;
  for (const t of tasks) {
    const raw = (t.completed ? "done" : (t.status || "not_started")) as string;
    const s = raw === "amber" ? "yellow" : raw;
    if (s === "red") out.red++;
    else if (s === "yellow") out.yellow++;
    else if (s === "green") out.green++;
    else if (s === "done") out.done++;
    else if (s === "not_started") out.not_started++;
  }
  return out;
}

export interface AssigneeInfo {
  user_id: string;
  display_name: string | null;
  assignment_status?: string;
  responded_at?: string | null;
  decline_reason?: string | null;
}

export interface WorkstreamTask {
  id: string;
  card_id: string;
  parent_task_id: string | null;
  title: string;
  description: string;
  assignee_id: string | null;
  due_date: string | null;
  completed: boolean;
  status: CardStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
  assignee_name?: string;
  assignees?: AssigneeInfo[];
  comments_count?: number;
  subtasks?: WorkstreamTask[];
}

export interface WorkstreamComment {
  id: string;
  card_id: string;
  user_id: string;
  content: string;
  created_at: string;
  user_name?: string;
}

export interface WorkstreamActivity {
  id: string;
  card_id: string;
  user_id: string;
  action: string;
  details: Record<string, any>;
  created_at: string;
  user_name?: string;
}

export interface UserProfile {
  user_id: string;
  display_name: string | null;
  role_title: string | null;
  avatar_url: string | null;
}

export function useUserProfiles(options?: { approvedOnly?: boolean }) {
  return useQuery({
    queryKey: ["user-profiles-all", options?.approvedOnly ?? true],
    queryFn: async () => {
      let query = supabase
        .from("profiles")
        .select("user_id, display_name, role_title, avatar_url")
        .order("display_name");

      if (options?.approvedOnly ?? true) {
        query = query.eq("approval_status", "approved");
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as UserProfile[];
    },
  });
}

// Fetch all cards with task counts and assignees
export function useWorkstreamCards(filters?: {
  status?: CardStatus;
  assignee?: string;
  priority?: CardPriority;
  project_tag?: string;
  search?: string;
}) {
  return useQuery({
    queryKey: ["workstream-cards", filters],
    queryFn: async () => {
      let query = supabase
        .from("workstream_cards")
        .select("*")
        .is("archived_at", null)
        .order("updated_at", { ascending: false });

      if (filters?.status) query = query.eq("status", filters.status);
      if (filters?.priority) query = query.eq("priority", filters.priority);
      if (filters?.project_tag) query = query.eq("project_tag", filters.project_tag);
      if (filters?.search) query = query.or(`title.ilike.%${filters.search}%,description.ilike.%${filters.search}%`);

      const { data: cards, error } = await query;
      if (error) throw error;
      if (!cards || cards.length === 0) return [];

      const cardIds = cards.map(c => c.id);

      // Fetch task counts, card assignees, and owner profiles in parallel
      const [tasksRes, cardAssigneesRes] = await Promise.all([
        supabase.from("workstream_tasks").select("card_id, completed, status, parent_task_id").in("card_id", cardIds),
        supabase.from("workstream_card_assignees").select("card_id, user_id, assignment_status, responded_at, decline_reason").in("card_id", cardIds),
      ]);

      // Collect all user IDs for profile resolution
      const allUserIds = new Set<string>();
      cards.forEach(c => { if (c.owner_id) allUserIds.add(c.owner_id); });
      (cardAssigneesRes.data || []).forEach(a => allUserIds.add(a.user_id));

      let profileMap: Record<string, string> = {};
      if (allUserIds.size > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", [...allUserIds]);
        profileMap = (profiles || []).reduce((acc, p) => ({ ...acc, [p.user_id]: p.display_name || "Unknown" }), {});
      }

      // Aggregate task counts + group raw tasks per card for overall-status computation
      const taskCounts: Record<string, { total: number; completed: number }> = {};
      const tasksByCard: Record<string, Array<{ status?: string | null; completed?: boolean }>> = {};
      (tasksRes.data || []).forEach((t: any) => {
        if (t.parent_task_id) return; // only count top-level tasks for card rollup
        if (!taskCounts[t.card_id]) taskCounts[t.card_id] = { total: 0, completed: 0 };
        taskCounts[t.card_id].total++;
        if (t.completed) taskCounts[t.card_id].completed++;
        if (!tasksByCard[t.card_id]) tasksByCard[t.card_id] = [];
        tasksByCard[t.card_id].push({ status: t.status, completed: t.completed });
      });

      // Aggregate card assignees
      const cardAssigneeMap: Record<string, AssigneeInfo[]> = {};
      (cardAssigneesRes.data || []).forEach((a: any) => {
        if (!cardAssigneeMap[a.card_id]) cardAssigneeMap[a.card_id] = [];
        cardAssigneeMap[a.card_id].push({ user_id: a.user_id, display_name: profileMap[a.user_id] || "Unknown", assignment_status: a.assignment_status, responded_at: a.responded_at, decline_reason: a.decline_reason });
      });

      // Filter by assignee if needed (check both owner_id and card_assignees)
      let filteredCards = cards;
      if (filters?.assignee) {
        filteredCards = cards.filter(c =>
          c.owner_id === filters.assignee ||
          (cardAssigneeMap[c.id] || []).some(a => a.user_id === filters.assignee)
        );
      }

      return filteredCards.map(c => {
        const cardTasks = tasksByCard[c.id] || [];
        return {
          ...c,
          status: c.status as CardStatus,
          priority: c.priority as CardPriority,
          tasks_total: taskCounts[c.id]?.total || 0,
          tasks_completed: taskCounts[c.id]?.completed || 0,
          owner_name: c.owner_id ? profileMap[c.owner_id] : undefined,
          assignees: cardAssigneeMap[c.id] || [],
          overall_status: getOverallStatus(cardTasks),
          task_breakdown: getTaskBreakdown(cardTasks),
        };
      }) as WorkstreamCard[];
    },
  });
}

// Fetch single card with full details
export function useWorkstreamCard(cardId: string | null) {
  return useQuery({
    queryKey: ["workstream-card", cardId],
    enabled: !!cardId,
    queryFn: async () => {
      if (!cardId) return null;

      const { data: card, error } = await supabase
        .from("workstream_cards")
        .select("*")
        .eq("id", cardId)
        .single();
      if (error) throw error;

      // Fetch tasks, comments, activity, card assignees, task assignees in parallel
      const [tasksRes, commentsRes, activityRes, cardAssigneesRes] = await Promise.all([
        supabase.from("workstream_tasks").select("*").eq("card_id", cardId).order("sort_order"),
        supabase.from("workstream_comments").select("*").eq("card_id", cardId).order("created_at", { ascending: false }),
        supabase.from("workstream_activity").select("*").eq("card_id", cardId).order("created_at", { ascending: false }).limit(50),
        supabase.from("workstream_card_assignees").select("card_id, user_id, assignment_status, responded_at, decline_reason").eq("card_id", cardId),
      ]);

      const tasks = tasksRes.data || [];
      const comments = commentsRes.data || [];
      const activity = activityRes.data || [];
      const cardAssignees = cardAssigneesRes.data || [];

      // Fetch task assignees if there are tasks
      let taskAssigneeMap: Record<string, AssigneeInfo[]> = {};
      let taskCommentCountMap: Record<string, number> = {};
      if (tasks.length > 0) {
        const taskIds = tasks.map(t => t.id);
        const [taRes, tcRes] = await Promise.all([
          supabase.from("workstream_task_assignees").select("task_id, user_id").in("task_id", taskIds),
          supabase.from("workstream_task_comments").select("task_id").in("task_id", taskIds),
        ]);
        const taskAssignees = taRes.data || [];
        (tcRes.data || []).forEach((row: any) => {
          taskCommentCountMap[row.task_id] = (taskCommentCountMap[row.task_id] || 0) + 1;
        });

        // Collect user IDs from task assignees
        const taUserIds = (taskAssignees || []).map(ta => ta.user_id);

        // Get all user IDs for name resolution
        const userIds = new Set<string>();
        if (card.owner_id) userIds.add(card.owner_id);
        userIds.add(card.created_by);
        tasks.forEach(t => { if (t.assignee_id) userIds.add(t.assignee_id); });
        comments.forEach(c => userIds.add(c.user_id));
        activity.forEach(a => userIds.add(a.user_id));
        cardAssignees.forEach(a => userIds.add(a.user_id));
        taUserIds.forEach(id => userIds.add(id));

        let profileMap: Record<string, string> = {};
        if (userIds.size > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("user_id, display_name")
            .in("user_id", [...userIds]);
          profileMap = (profiles || []).reduce((acc, p) => ({ ...acc, [p.user_id]: p.display_name || "Unknown" }), {});
        }

        // Build task assignee map
        (taskAssignees || []).forEach(ta => {
          if (!taskAssigneeMap[ta.task_id]) taskAssigneeMap[ta.task_id] = [];
          taskAssigneeMap[ta.task_id].push({ user_id: ta.user_id, display_name: profileMap[ta.user_id] || "Unknown" });
        });

        const mappedTasks = tasks.map(t => ({
          ...t,
          status: ((t as any).status || (t.completed ? "done" : "not_started")) as CardStatus,
          assignee_name: t.assignee_id ? profileMap[t.assignee_id] : undefined,
          assignees: taskAssigneeMap[t.id] || [],
          comments_count: taskCommentCountMap[t.id] || 0,
        })) as WorkstreamTask[];

        // Nest subtasks under their parents
        const topLevel = mappedTasks.filter(t => !t.parent_task_id);
        const childrenByParent: Record<string, WorkstreamTask[]> = {};
        mappedTasks.forEach(t => {
          if (t.parent_task_id) {
            (childrenByParent[t.parent_task_id] ||= []).push(t);
          }
        });
        const nestedTasks = topLevel.map(t => ({
          ...t,
          subtasks: (childrenByParent[t.id] || []).sort((a, b) => a.sort_order - b.sort_order),
        }));

        return {
          card: {
            ...card,
            status: card.status as CardStatus,
            priority: card.priority as CardPriority,
            owner_name: card.owner_id ? profileMap[card.owner_id] : undefined,
            assignees: cardAssignees.map((a: any) => ({ user_id: a.user_id, display_name: profileMap[a.user_id] || "Unknown", assignment_status: a.assignment_status, responded_at: a.responded_at, decline_reason: a.decline_reason })),
            overall_status: getOverallStatus(topLevel),
            task_breakdown: getTaskBreakdown(topLevel),
          } as WorkstreamCard,
          tasks: nestedTasks,
          comments: comments.map(c => ({ ...c, user_name: profileMap[c.user_id] })) as WorkstreamComment[],
          activity: activity.map(a => ({ ...a, user_name: profileMap[a.user_id] })) as WorkstreamActivity[],
        };
      }

      // No tasks case - still resolve profiles
      const userIds = new Set<string>();
      if (card.owner_id) userIds.add(card.owner_id);
      userIds.add(card.created_by);
      comments.forEach(c => userIds.add(c.user_id));
      activity.forEach(a => userIds.add(a.user_id));
      cardAssignees.forEach(a => userIds.add(a.user_id));

      let profileMap: Record<string, string> = {};
      if (userIds.size > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", [...userIds]);
        profileMap = (profiles || []).reduce((acc, p) => ({ ...acc, [p.user_id]: p.display_name || "Unknown" }), {});
      }

      return {
        card: {
          ...card,
          status: card.status as CardStatus,
          priority: card.priority as CardPriority,
          owner_name: card.owner_id ? profileMap[card.owner_id] : undefined,
          assignees: cardAssignees.map((a: any) => ({ user_id: a.user_id, display_name: profileMap[a.user_id] || "Unknown", assignment_status: a.assignment_status, responded_at: a.responded_at, decline_reason: a.decline_reason })),
          overall_status: getOverallStatus([]),
          task_breakdown: getTaskBreakdown([]),
        } as WorkstreamCard,
        tasks: [] as WorkstreamTask[],
        comments: comments.map(c => ({ ...c, user_name: profileMap[c.user_id] })) as WorkstreamComment[],
        activity: activity.map(a => ({ ...a, user_name: profileMap[a.user_id] })) as WorkstreamActivity[],
      };
    },
  });
}

// Card mutations
export function useCreateCard() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      title: string; description?: string; status?: CardStatus; priority?: CardPriority;
      owner_id?: string; due_date?: string; project_tag?: string; assignee_ids?: string[];
    }) => {
      if (!user) throw new Error("Not authenticated");
      const { assignee_ids, ...cardInput } = input;
      const { data, error } = await supabase
        .from("workstream_cards")
        .insert({ status: "not_started", ...cardInput, created_by: user.id })
        .select("id")
        .single();
      if (error) throw error;

      // Insert assignees
      if (assignee_ids && assignee_ids.length > 0) {
        await supabase.from("workstream_card_assignees").insert(
          assignee_ids.map(uid => ({ card_id: data.id, user_id: uid }))
        );
      }

      await supabase.from("workstream_activity").insert({
        card_id: data.id, user_id: user.id, action: "card_created", details: { title: input.title },
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workstream-cards"] });
      qc.invalidateQueries({ queryKey: ["workstream-project-tags"] });
      toast.success("Card created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateCard() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<WorkstreamCard> & { id: string }) => {
      if (!user) throw new Error("Not authenticated");
      // Remove non-DB fields
      const { assignees, tasks_total, tasks_completed, owner_name, ...dbUpdates } = updates as any;
      const { error } = await supabase
        .from("workstream_cards")
        .update({ ...dbUpdates, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;

      if (updates.status) {
        await supabase.from("workstream_activity").insert({
          card_id: id, user_id: user.id, action: "status_changed", details: { new_status: updates.status },
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workstream-cards"] });
      qc.invalidateQueries({ queryKey: ["workstream-card"] });
      qc.invalidateQueries({ queryKey: ["workstream-project-tags"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateCardAssignees() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ cardId, userIds }: { cardId: string; userIds: string[] }) => {
      // Delete existing, then insert new
      await supabase.from("workstream_card_assignees").delete().eq("card_id", cardId);
      if (userIds.length > 0) {
        const { error } = await supabase.from("workstream_card_assignees").insert(
          userIds.map(uid => ({ card_id: cardId, user_id: uid }))
        );
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workstream-cards"] });
      qc.invalidateQueries({ queryKey: ["workstream-card"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("workstream_cards").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workstream-cards"] });
      toast.success("Card deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Task mutations
export function useCreateTask() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { card_id: string; title: string; description?: string; assignee_id?: string; due_date?: string; sort_order?: number; assignee_ids?: string[] }) => {
      const { assignee_ids, ...taskInput } = input;
      const { data, error } = await supabase
        .from("workstream_tasks")
        .insert({ status: "not_started", ...taskInput })
        .select()
        .single();
      if (error) throw error;

      // Insert task assignees
      if (assignee_ids && assignee_ids.length > 0) {
        await supabase.from("workstream_task_assignees").insert(
          assignee_ids.map(uid => ({ task_id: data.id, user_id: uid }))
        );
      }

      if (user) {
        await supabase.from("workstream_activity").insert({
          card_id: input.card_id, user_id: user.id, action: "task_added", details: { title: input.title },
        });
      }
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workstream-card", vars.card_id] });
      qc.invalidateQueries({ queryKey: ["workstream-cards"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, card_id, ...updates }: Partial<WorkstreamTask> & { id: string; card_id: string }) => {
      const { assignees, assignee_name, ...dbUpdates } = updates as any;
      const { error } = await supabase
        .from("workstream_tasks")
        .update({ ...dbUpdates, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;

      if (user && updates.completed !== undefined) {
        await supabase.from("workstream_activity").insert({
          card_id, user_id: user.id,
          action: updates.completed ? "task_completed" : "task_uncompleted",
          details: { task_id: id },
        });
      }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workstream-card", vars.card_id] });
      qc.invalidateQueries({ queryKey: ["workstream-cards"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateTaskAssignees() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, cardId, userIds }: { taskId: string; cardId: string; userIds: string[] }) => {
      await supabase.from("workstream_task_assignees").delete().eq("task_id", taskId);
      if (userIds.length > 0) {
        const { error } = await supabase.from("workstream_task_assignees").insert(
          userIds.map(uid => ({ task_id: taskId, user_id: uid }))
        );
        if (error) throw error;
      }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workstream-card", vars.cardId] });
      qc.invalidateQueries({ queryKey: ["workstream-cards"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, card_id }: { id: string; card_id: string }) => {
      const { error } = await supabase.from("workstream_tasks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workstream-card", vars.card_id] });
      qc.invalidateQueries({ queryKey: ["workstream-cards"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Comment mutations
export function useAddComment() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { card_id: string; content: string }) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("workstream_comments")
        .insert({ ...input, user_id: user.id });
      if (error) throw error;

      await supabase.from("workstream_activity").insert({
        card_id: input.card_id, user_id: user.id, action: "comment_added", details: {},
      });
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workstream-card", vars.card_id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, card_id }: { id: string; card_id: string }) => {
      const { error } = await supabase.from("workstream_comments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workstream-card", vars.card_id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Task comment types + hooks
export interface WorkstreamTaskComment {
  id: string;
  task_id: string;
  user_id: string;
  content: string;
  created_at: string;
  user_name?: string;
}

export function useTaskComments(taskId: string | null) {
  return useQuery({
    queryKey: ["workstream-task-comments", taskId],
    enabled: !!taskId,
    queryFn: async () => {
      if (!taskId) return [];
      const { data, error } = await supabase
        .from("workstream_task_comments")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = data || [];
      if (rows.length === 0) return [] as WorkstreamTaskComment[];
      const userIds = [...new Set(rows.map(r => r.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", userIds);
      const nameMap: Record<string, string> = (profiles || []).reduce(
        (acc, p) => ({ ...acc, [p.user_id]: p.display_name || "Unknown" }),
        {},
      );
      return rows.map(r => ({ ...r, user_name: nameMap[r.user_id] })) as WorkstreamTaskComment[];
    },
  });
}

export function useAddTaskComment() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { task_id: string; card_id: string; content: string }) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("workstream_task_comments")
        .insert({ task_id: input.task_id, content: input.content, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workstream-task-comments", vars.task_id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteTaskComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, task_id }: { id: string; task_id: string }) => {
      const { error } = await supabase.from("workstream_task_comments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workstream-task-comments", vars.task_id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateTaskComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, task_id, content }: { id: string; task_id: string; content: string }) => {
      const { error } = await supabase
        .from("workstream_task_comments")
        .update({ content })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workstream-task-comments", vars.task_id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, card_id, content }: { id: string; card_id: string; content: string }) => {
      const { error } = await supabase
        .from("workstream_comments")
        .update({ content })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workstream-card", vars.card_id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Accept or decline an assignment
export function useRespondToAssignment() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ cardId, response, declineReason }: {
      cardId: string;
      response: "accepted" | "declined";
      declineReason?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");

      const updatePayload: {
        assignment_status: string;
        responded_at: string;
        decline_reason?: string;
      } = {
        assignment_status: response,
        responded_at: new Date().toISOString(),
      };
      if (response === "declined" && declineReason) {
        updatePayload.decline_reason = declineReason;
      }

      const { error } = await supabase
        .from("workstream_card_assignees")
        .update(updatePayload)
        .eq("card_id", cardId)
        .eq("user_id", user.id);
      if (error) throw error;

      // Log activity
      await supabase.from("workstream_activity").insert({
        card_id: cardId,
        user_id: user.id,
        action: response === "accepted" ? "assignment_accepted" : "assignment_declined",
        details: declineReason ? { decline_reason: declineReason } : {},
      });
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["workstream-cards"] });
      qc.invalidateQueries({ queryKey: ["workstream-card", vars.cardId] });
      toast.success(vars.response === "accepted" ? "Assignment accepted" : "Assignment declined");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Distinct project tags derived from existing cards (admin can extend at create time).
export function useProjectTags() {
  return useQuery({
    queryKey: ["workstream-project-tags"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workstream_cards")
        .select("project_tag")
        .not("project_tag", "is", null);
      if (error) throw error;
      const set = new Set<string>();
      (data ?? []).forEach((r: { project_tag: string | null }) => {
        if (r.project_tag && r.project_tag.trim()) set.add(r.project_tag.trim());
      });
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    },
    staleTime: 60_000,
  });
}
