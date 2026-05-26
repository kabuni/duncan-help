import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export interface Release {
  id: string;
  version: string;
  title: string;
  summary: string;
  changes: { type: string; description: string }[];
  status: string;
  published_at: string | null;
  published_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function useReleases(statusFilter?: string) {
  return useQuery({
    queryKey: ["releases", statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("releases")
        .select("*")
        .order("created_at", { ascending: false });
      if (statusFilter) {
        query = query.eq("status", statusFilter);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as Release[];
    },
  });
}

export function useCreateRelease() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (release: { version: string; title: string; summary: string; changes: { type: string; description: string }[] }) => {
      const { data, error } = await supabase
        .from("releases")
        .insert({ ...release, changes: release.changes as any, created_by: user!.id, status: "draft" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["releases"] });
      toast({ title: "Release created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
}

export function useUpdateRelease() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Release> & { id: string }) => {
      const { error } = await supabase
        .from("releases")
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["releases"] });
      toast({ title: "Release updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
}

export function usePublishRelease() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (releaseId: string) => {
      // Update status to published
      const { error: updateError } = await supabase
        .from("releases")
        .update({ status: "published", published_at: new Date().toISOString(), published_by: user!.id } as any)
        .eq("id", releaseId);
      if (updateError) throw updateError;

      // Trigger email sending via edge function
      try {
        const { error: fnError } = await supabase.functions.invoke("send-release-emails", {
          body: { releaseId },
        });
        if (fnError) throw fnError;
      } catch (fnError: any) {
        console.error("Email sending failed:", fnError);
        toast({ title: "Published", description: "Release published but email sending failed. You can retry from the release manager.", variant: "destructive" });
        return;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["releases"] });
      toast({ title: "Release published & emails sent!" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
}

export function useDeleteRelease() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("releases").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["releases"] });
      toast({ title: "Release deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
}
