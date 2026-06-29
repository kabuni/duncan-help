import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SchoolTrackerStatus = "registered" | "confirmed" | "pending" | "declined";

export interface SchoolTrackerRow {
  id: string;
  name: string;
  region: string;
  status: SchoolTrackerStatus;
  progress_pct: number;
  student_count: number;
  created_at: string;
}

export function useSchoolTracker() {
  return useQuery({
    queryKey: ["school_tracker"],
    queryFn: async (): Promise<SchoolTrackerRow[]> => {
      const { data, error } = await (supabase as any)
        .from("school_tracker")
        .select("id,name,region,status,progress_pct,student_count,created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as SchoolTrackerRow[];
    },
  });
}
