import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/* Commercial Growth — "schools signed" count.
   Stored in public.app_settings (key: commercial_growth_schools_signed).
   Readable by all authenticated users; only admins can write (RLS). */

export const SCHOOLS_SIGNED_KEY = "commercial_growth_schools_signed";

export function useSchoolsSigned(fallback: number) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["app-setting", SCHOOLS_SIGNED_KEY],
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", SCHOOLS_SIGNED_KEY)
        .maybeSingle();
      if (error) throw error;
      const raw = data?.value as unknown;
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n) ? n : fallback;
    },
  });

  const save = useMutation({
    mutationFn: async (value: number) => {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: SCHOOLS_SIGNED_KEY, value: value as never }, { onConflict: "key" });
      if (error) throw error;
      return value;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app-setting", SCHOOLS_SIGNED_KEY] }),
  });

  return {
    signed: query.data ?? fallback,
    isLoading: query.isLoading,
    save,
  };
}
