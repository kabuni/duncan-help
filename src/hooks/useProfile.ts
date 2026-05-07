import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export interface ProfileData {
  display_name: string | null;
  department: string | null;
  avatar_url: string | null;
  role_title: string | null;
  bio: string | null;
  norman_context: string | null;
  preferences: Record<string, unknown>;
  approval_status: string;
  requested_role_title: string | null;
  onboarding_completed_at: string | null;
  onboarding_step: string;
}

export function useProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, department, avatar_url, role_title, bio, norman_context, preferences, approval_status, requested_role_title")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as ProfileData | null;
    },
  });

  const mutation = useMutation({
    mutationFn: async (updates: Partial<ProfileData>) => {
      const { error } = await supabase
        .from("profiles")
        .update(updates as any)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
      toast.success("Profile updated");
    },
    onError: (e) => toast.error(e.message),
  });

  return { profile: query.data, isLoading: query.isLoading, updateProfile: mutation.mutate, isSaving: mutation.isPending };
}
