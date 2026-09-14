import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface DirectoryMember {
  id: string;
  user_id: string;
  display_name: string | null;
  role_title: string | null;
  department: string | null;
}

/**
 * The existing Duncan users/team directory. Used anywhere a person has to be
 * picked (e.g. choosing a line manager) so no names are ever free text.
 */
export function useTeamDirectory() {
  return useQuery({
    queryKey: ["team-directory"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, user_id, display_name, role_title, department")
        .eq("approval_status", "approved")
        .order("display_name", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as DirectoryMember[]).filter((m) => !!m.display_name);
    },
    staleTime: 5 * 60_000,
  });
}
