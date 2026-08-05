import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logSavings } from "@/lib/savings";


export interface Plan90Workstream {
  id: string;
  name: string;
  description: string | null;
  display_order: number;
  archived: boolean;
}

export interface Plan90Deliverable {
  id: string;
  workstream_id: string;
  title: string;
  owner_user_id: string | null;
  owner_display_name: string | null;
  due_date: string | null;
  status: string;
  priority: string;
  progress_percent: number | null;
  notes: string | null;
  archived: boolean;
  updated_at: string;
}

export interface Plan90Attachment {
  id: string;
  deliverable_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

export const PLAN90_STATUSES = ["Not Started", "In Progress", "At Risk", "Blocked", "Stopped", "Completed"] as const;
export const PLAN90_PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;

export function usePlan90() {
  const [workstreams, setWorkstreams] = useState<Plan90Workstream[]>([]);
  const [deliverables, setDeliverables] = useState<Plan90Deliverable[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: ws }, { data: d }] = await Promise.all([
      supabase.from("plan90_workstreams" as any).select("*").order("display_order"),
      supabase.from("plan90_deliverables" as any).select("*").order("display_order", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true }),
    ]);
    setWorkstreams((ws as any) || []);
    setDeliverables((d as any) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("plan90-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "plan90_workstreams" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "plan90_deliverables" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const updateDeliverable = useCallback(async (id: string, patch: Partial<Plan90Deliverable>) => {
    const { error } = await supabase.from("plan90_deliverables" as any).update(patch).eq("id", id);
    if (error) { toast.error(error.message); return false; }
    logSavings("ui.plan90.update_deliverable", { deliverable_id: id });
    return true;
  }, []);


  const createDeliverable = useCallback(async (row: Partial<Plan90Deliverable>) => {
    const { error } = await supabase.from("plan90_deliverables" as any).insert(row as any);
    if (error) { toast.error(error.message); return false; }
    toast.success("Deliverable added");
    return true;
  }, []);

  const deleteDeliverable = useCallback(async (id: string) => {
    const { error } = await supabase.from("plan90_deliverables" as any).delete().eq("id", id);
    if (error) { toast.error(error.message); return false; }
    return true;
  }, []);

  const createWorkstream = useCallback(async (name: string) => {
    const nextOrder = Math.max(0, ...workstreams.map((w) => w.display_order)) + 10;
    const { error } = await supabase.from("plan90_workstreams" as any).insert({ name, display_order: nextOrder } as any);
    if (error) { toast.error(error.message); return false; }
    toast.success("Workstream added");
    return true;
  }, [workstreams]);

  const updateWorkstream = useCallback(async (id: string, patch: Partial<Plan90Workstream>) => {
    const { error } = await supabase.from("plan90_workstreams" as any).update(patch).eq("id", id);
    if (error) { toast.error(error.message); return false; }
    return true;
  }, []);

  const deleteWorkstream = useCallback(async (id: string) => {
    const { error } = await supabase.from("plan90_workstreams" as any).delete().eq("id", id);
    if (error) { toast.error(error.message); return false; }
    return true;
  }, []);

  return {
    workstreams, deliverables, loading, refresh: load,
    updateDeliverable, createDeliverable, deleteDeliverable,
    createWorkstream, updateWorkstream, deleteWorkstream,
  };
}
