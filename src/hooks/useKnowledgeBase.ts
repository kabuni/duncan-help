import { useState, useCallback } from "react";
import { fastApi } from "@/lib/fastApiClient";
import { getAuthUser } from "@/lib/authStorage";

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
      const user = getAuthUser();
      const data = await fastApi("POST", "/query-knowledge-base", {
        query: message,
        user_id: user?.id,
        match_count: 8,
      });
      const results: KBResult[] = (data as any)?.results ?? [];
      const formattedContext: string = (data as any)?.formatted_context ?? "";
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
