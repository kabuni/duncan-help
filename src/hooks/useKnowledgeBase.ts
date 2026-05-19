import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface KBResult {
  id: string;
  document_id: string;
  content: string;
  chunk_index: number;
  similarity: number;
  document_title: string;
  metadata?: any;
}

export function useKnowledgeBase() {
  const [isSearching, setIsSearching] = useState(false);

  const queryKnowledgeBase = useCallback(async (message: string) => {
    setIsSearching(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke("query-knowledge-base", {
        body: { query: message, user_id: userData?.user?.id, match_count: 8 },
      });
      if (error) throw error;
      const results: KBResult[] = data?.results ?? [];
      const formattedContext: string = data?.formatted_context ?? "";
      return { results, formattedContext, hasResults: results.length > 0 };
    } catch (e) {
      console.error("queryKnowledgeBase failed", e);
      return { results: [], formattedContext: "", hasResults: false };
    } finally {
      setIsSearching(false);
    }
  }, []);

  return { queryKnowledgeBase, isSearching };
}
