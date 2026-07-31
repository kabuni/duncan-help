import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logSavings } from "@/lib/savings";


export type Plan90Ryg = "green" | "amber" | "red";

export interface Plan90Update {
  id: string;
  deliverable_id: string;
  author_id: string | null;
  author_name: string;
  message: string;
  ryg: Plan90Ryg;
  created_at: string;
  updated_at: string;
}

/**
 * Fetches ALL updates across deliverables once, keeps them fresh via realtime,
 * and exposes:
 *  - latestByDeliverable: newest update per deliverable_id (for row previews + rollup)
 *  - listFor(id): full chronological history (newest first) for one deliverable
 */
export function usePlan90Updates() {
  const [items, setItems] = useState<Plan90Update[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("plan90_deliverable_updates" as any)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[plan90-updates] load failed", error);
      setItems([]);
    } else {
      setItems((data as any) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("plan90-updates-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plan90_deliverable_updates" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const latestByDeliverable = useMemo(() => {
    const map = new Map<string, Plan90Update>();
    for (const u of items) {
      const existing = map.get(u.deliverable_id);
      if (!existing || u.created_at > existing.created_at) map.set(u.deliverable_id, u);
    }
    return map;
  }, [items]);

  const listFor = useCallback(
    (deliverableId: string) =>
      items.filter((u) => u.deliverable_id === deliverableId), // already sorted desc
    [items],
  );

  const post = useCallback(
    async (deliverableId: string, message: string, ryg: Plan90Ryg) => {
      const trimmed = message.trim();
      if (!trimmed) return false;
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        toast.error("Not signed in");
        return false;
      }
      // Snapshot author name from profiles
      const { data: prof } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", u.user.id)
        .maybeSingle();
      const author_name =
        (prof?.display_name as string | undefined) ||
        u.user.email?.split("@")[0] ||
        "Unknown";
      const { error } = await supabase.from("plan90_deliverable_updates" as any).insert({
        deliverable_id: deliverableId,
        author_id: u.user.id,
        author_name,
        message: trimmed,
        ryg,
      } as any);
      if (error) {
        toast.error(error.message);
        return false;
      }
      logSavings("ui.plan90.add_update", { deliverable_id: deliverableId });
      return true;

    },
    [],
  );

  const edit = useCallback(async (id: string, message: string, ryg: Plan90Ryg) => {
    const trimmed = message.trim();
    if (!trimmed) return false;
    const { error } = await supabase
      .from("plan90_deliverable_updates" as any)
      .update({ message: trimmed, ryg } as any)
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    return true;
  }, []);

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase
      .from("plan90_deliverable_updates" as any)
      .delete()
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    return true;
  }, []);

  return { items, loading, latestByDeliverable, listFor, post, edit, remove, refresh: load };
}
