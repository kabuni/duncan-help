import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SchoolTrackerStatus = "registered" | "confirmed" | "pending" | "declined";

export interface SchoolTrackerRow {
  id: string;
  name: string;
  region: string;
  status: SchoolTrackerStatus;
  progress_pct: number;
  student_count: number;
  contact_name: string | null;
  contact_email: string | null;
  created_at: string;
}

export interface NewSchoolInput {
  name: string;
  region: string;
  status: SchoolTrackerStatus;
  progress_pct: number;
  student_count: number;
  contact_name?: string | null;
  contact_email?: string | null;
}

const SELECT_COLS =
  "id,name,region,status,progress_pct,student_count,contact_name,contact_email,created_at";

export function useSchoolTracker() {
  return useQuery({
    queryKey: ["school_tracker"],
    queryFn: async (): Promise<SchoolTrackerRow[]> => {
      const { data, error } = await (supabase as any)
        .from("school_tracker")
        .select(SELECT_COLS)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as SchoolTrackerRow[];
    },
  });
}

export function useCreateSchool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewSchoolInput) => {
      const { error } = await (supabase as any).from("school_tracker").insert(input);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["school_tracker"] }),
  });
}
