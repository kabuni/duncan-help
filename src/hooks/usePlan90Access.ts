import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useUserRoles";

/**
 * Who can edit the 90-Day Tracker: admins, plus any user listed in plan90_editors.
 * Mirrors the database function public.can_edit_plan90().
 */
export function usePlan90CanEdit() {
  const { user } = useAuth();
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();

  const { data: isEditor = false, isLoading: editorLoading } = useQuery({
    queryKey: ["plan90-editor", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan90_editors" as any)
        .select("user_id")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) return false;
      return !!data;
    },
    staleTime: 5 * 60_000,
  });

  return {
    canEdit: isAdmin || isEditor,
    isLoading: adminLoading || (!!user && editorLoading),
  };
}
