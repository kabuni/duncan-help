import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type SupplierType = "supplier" | "stakeholder" | "partner";
export type ContractStatus = "active" | "pending" | "expired" | "none";

export interface Supplier {
  id: string;
  name: string;
  type: SupplierType;
  website: string | null;
  logo_url: string | null;
  services: string[];
  contract_status: ContractStatus | null;
  rate: string | null;
  currency: string | null;
  renewal_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplierContact {
  id: string;
  supplier_id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
}

export interface SupplierWorkstreamLink {
  id: string;
  supplier_id: string;
  workstream_card_id: string;
  card?: {
    id: string;
    title: string;
    status: string;
    project_tag: string | null;
  };
}

export function useSuppliers(search?: string) {
  return useQuery({
    queryKey: ["suppliers", search],
    queryFn: async () => {
      let q = supabase.from("suppliers").select("*").order("name");
      if (search) q = q.ilike("name", `%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as Supplier[];
    },
  });
}

export function useSupplierDetail(id: string | null) {
  return useQuery({
    queryKey: ["supplier-detail", id],
    enabled: !!id,
    queryFn: async () => {
      const [supRes, contactsRes, linksRes] = await Promise.all([
        supabase.from("suppliers").select("*").eq("id", id!).maybeSingle(),
        supabase.from("supplier_contacts").select("*").eq("supplier_id", id!).order("is_primary", { ascending: false }),
        supabase.from("supplier_workstreams").select("*").eq("supplier_id", id!),
      ]);
      if (supRes.error) throw supRes.error;
      if (contactsRes.error) throw contactsRes.error;
      if (linksRes.error) throw linksRes.error;

      const links = (linksRes.data || []) as SupplierWorkstreamLink[];
      let cards: any[] = [];
      if (links.length > 0) {
        const ids = links.map(l => l.workstream_card_id);
        const { data } = await supabase
          .from("workstream_cards")
          .select("id, title, status, project_tag")
          .in("id", ids);
        cards = data || [];
      }
      const linksWithCards = links.map(l => ({
        ...l,
        card: cards.find(c => c.id === l.workstream_card_id),
      }));

      return {
        supplier: supRes.data as Supplier | null,
        contacts: (contactsRes.data || []) as SupplierContact[],
        workstreamLinks: linksWithCards,
      };
    },
  });
}

export function useUpsertSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<Supplier> & { name: string }) => {
      if (input.id) {
        const { id, created_at, updated_at, ...rest } = input as any;
        const { error } = await supabase.from("suppliers").update(rest).eq("id", id);
        if (error) throw error;
        return id;
      } else {
        const { data, error } = await supabase.from("suppliers").insert(input as any).select("id").single();
        if (error) throw error;
        return data.id;
      }
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["supplier-detail", id] });
      toast.success("Supplier saved");
    },
    onError: (e: any) => toast.error(e.message || "Failed to save supplier"),
  });
}

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("suppliers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Supplier deleted");
    },
    onError: (e: any) => toast.error(e.message || "Failed to delete"),
  });
}

export function useUpsertContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<SupplierContact> & { supplier_id: string; name: string }) => {
      if (input.id) {
        const { id, ...rest } = input as any;
        const { error } = await supabase.from("supplier_contacts").update(rest).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("supplier_contacts").insert(input as any);
        if (error) throw error;
      }
      return input.supplier_id;
    },
    onSuccess: (sid) => {
      qc.invalidateQueries({ queryKey: ["supplier-detail", sid] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to save contact"),
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, supplier_id }: { id: string; supplier_id: string }) => {
      const { error } = await supabase.from("supplier_contacts").delete().eq("id", id);
      if (error) throw error;
      return supplier_id;
    },
    onSuccess: (sid) => qc.invalidateQueries({ queryKey: ["supplier-detail", sid] }),
  });
}

export function useLinkWorkstream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ supplier_id, workstream_card_id }: { supplier_id: string; workstream_card_id: string }) => {
      const { error } = await supabase
        .from("supplier_workstreams")
        .insert({ supplier_id, workstream_card_id });
      if (error) throw error;
      return supplier_id;
    },
    onSuccess: (sid) => {
      qc.invalidateQueries({ queryKey: ["supplier-detail", sid] });
      toast.success("Project linked");
    },
    onError: (e: any) => toast.error(e.message || "Failed to link"),
  });
}

export function useUnlinkWorkstream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, supplier_id }: { id: string; supplier_id: string }) => {
      const { error } = await supabase.from("supplier_workstreams").delete().eq("id", id);
      if (error) throw error;
      return supplier_id;
    },
    onSuccess: (sid) => qc.invalidateQueries({ queryKey: ["supplier-detail", sid] }),
  });
}

export function useWorkstreamCardOptions() {
  return useQuery({
    queryKey: ["workstream-card-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workstream_cards")
        .select("id, title, status, project_tag")
        .is("archived_at", null)
        .order("title");
      if (error) throw error;
      return data || [];
    },
  });
}
