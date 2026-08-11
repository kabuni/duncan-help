import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type TodoPriority = "low" | "medium" | "high";

export interface Todo {
  id: string;
  user_id: string;
  created_by: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  priority: TodoPriority;
  completed: boolean;
  completed_at: string | null;
  source_type: string | null;
  source_id: string | null;
  created_at: string;
  updated_at: string;
  /** Display name of the person who created it (null when it's you) */
  created_by_name?: string | null;
  /** Display name of the assignee (set when you created it for someone else) */
  assignee_name?: string | null;
}

const TODOS_KEY = ["todos"];

/** Open to-dos assigned to me, plus ones I created for other people. */
export function useTodos(includeCompleted = false) {
  const { user } = useAuth();
  return useQuery<Todo[]>({
    queryKey: [...TODOS_KEY, user?.id, includeCompleted],
    enabled: !!user,
    queryFn: async () => {
      let q = (supabase as any)
        .from("todos")
        .select("*")
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (!includeCompleted) q = q.eq("completed", false);

      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as Todo[];
      if (rows.length === 0) return rows;

      const ids = Array.from(
        new Set(rows.flatMap((r) => [r.created_by, r.user_id])),
      );
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", ids);
      const names = new Map(
        (profiles ?? []).map((p: any) => [p.user_id, p.display_name as string | null]),
      );

      return rows.map((r) => ({
        ...r,
        created_by_name: r.created_by === user!.id ? null : names.get(r.created_by) ?? "Someone",
        assignee_name: r.user_id === user!.id ? null : names.get(r.user_id) ?? "Someone",
      }));
    },
  });
}

export interface CreateTodoInput {
  title: string;
  notes?: string | null;
  due_date?: string | null;
  priority?: TodoPriority;
  /** Defaults to the current user */
  assignee_user_id?: string | null;
  source_type?: string | null;
  source_id?: string | null;
}

export function useCreateTodo() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: CreateTodoInput) => {
      if (!user) throw new Error("Not signed in");
      const { data, error } = await (supabase as any)
        .from("todos")
        .insert({
          title: input.title.trim(),
          notes: input.notes?.trim() || null,
          due_date: input.due_date || null,
          priority: input.priority ?? "medium",
          user_id: input.assignee_user_id || user.id,
          created_by: user.id,
          source_type: input.source_type ?? null,
          source_id: input.source_id ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as Todo;
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...fields }: Partial<Todo> & { id: string }) => {
      const { error } = await (supabase as any).from("todos").update(fields).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useToggleTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const { error } = await (supabase as any)
        .from("todos")
        .update({ completed, completed_at: completed ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("todos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: TODOS_KEY });
  qc.invalidateQueries({ queryKey: ["home-dashboard"] });
  qc.invalidateQueries({ queryKey: ["home-briefing"] });
}

/** Lightweight team list for assigning a to-do to a colleague. */
export function useAssignableUsers() {
  return useQuery<{ user_id: string; display_name: string }[]>({
    queryKey: ["todos", "assignable-users"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .order("display_name", { ascending: true });
      if (error) throw error;
      return (data ?? [])
        .filter((p: any) => !!p.user_id)
        .map((p: any) => ({ user_id: p.user_id, display_name: p.display_name || "Unnamed" }));
    },
  });
}
