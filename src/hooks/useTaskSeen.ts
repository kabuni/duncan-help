import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

/**
 * Tracks when the user last looked at My tasks so newly allocated
 * tasks / to-dos can be highlighted as "New".
 *
 * The cutoff is captured once on mount (so badges stay visible for the whole
 * visit) and the stored timestamp is refreshed to "now" when the user leaves.
 */
export function useTaskSeen() {
  const { user } = useAuth();
  const storageKey = user ? `duncan_tasks_last_seen_${user.id}` : null;
  const [cutoff, setCutoff] = useState<number | null>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    if (!storageKey || readyRef.current) return;
    readyRef.current = true;
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? Date.parse(raw) : NaN;
    // First ever visit: treat anything from the last 3 days as new.
    setCutoff(Number.isNaN(parsed) ? Date.now() - 3 * 24 * 60 * 60 * 1000 : parsed);
  }, [storageKey]);

  const markSeen = useCallback(() => {
    if (storageKey) localStorage.setItem(storageKey, new Date().toISOString());
  }, [storageKey]);

  // Refresh the stored timestamp when leaving the page / closing the tab.
  useEffect(() => {
    if (!storageKey) return;
    window.addEventListener("beforeunload", markSeen);
    return () => {
      window.removeEventListener("beforeunload", markSeen);
      markSeen();
    };
  }, [storageKey, markSeen]);

  const isNew = useCallback(
    (createdAt?: string | null, createdBy?: string | null) => {
      if (!createdAt || cutoff === null) return false;
      if (createdBy && user && createdBy === user.id) return false; // you created it
      const t = Date.parse(createdAt);
      return !Number.isNaN(t) && t > cutoff;
    },
    [cutoff, user],
  );

  return { cutoff, isNew, markSeen };
}
