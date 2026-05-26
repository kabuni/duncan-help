import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type BriefingType = "morning";

interface CEOBriefingRow {
  id: string;
  briefing_date: string;
  briefing_type: BriefingType;
  trajectory: string | null;
  outcome_probability: number | null;
  execution_score: number | null;
  workstream_scores: any;
  payload: any;
  created_at: string;
}

interface JobState {
  jobId: string;
  status: "queued" | "gathering" | "synthesising" | "completed" | "failed";
  progress: number;
  phase: string;
}

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_MS = 5 * 60 * 1000; // 5-minute safety cap

export const useCEOBriefing = (type: BriefingType) => {
  const [briefing, setBriefing] = useState<CEOBriefingRow | null>(null);
  const [previous, setPrevious] = useState<CEOBriefingRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [job, setJob] = useState<JobState | null>(null);

  const pollTimer = useRef<number | null>(null);
  const pollDeadline = useRef<number>(0);

  const clearPoll = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("ceo_briefings")
      .select("*")
      .eq("briefing_type", type)
      .order("briefing_date", { ascending: false })
      .limit(2);
    if (error) {
      console.error("Load briefings error:", error);
    } else {
      setBriefing((data?.[0] as CEOBriefingRow) ?? null);
      setPrevious((data?.[1] as CEOBriefingRow) ?? null);
    }
    setLoading(false);
  }, [type]);

  useEffect(() => {
    load();
    return () => clearPoll();
  }, [load, clearPoll]);

  const pollOnce = useCallback(
    async (jobId: string) => {
      try {
        const { data, error } = await supabase.functions.invoke("ceo-briefing-status", {
          body: { job_id: jobId },
        });
        if (error) throw error;

        const status = data?.status as JobState["status"] | undefined;
        const jobError = typeof data?.error === "string" ? data.error : null;
        if (!status) {
          throw new Error(jobError || "Invalid status response from briefing job");
        }

        setJob({
          jobId,
          status,
          progress: data?.progress ?? 0,
          phase: data?.phase ?? "",
        });

        if (status === "completed") {
          clearPoll();
          await load();
          toast.success("Briefing generated");
          setGenerating(false);
          setJob(null);
          return;
        }
        if (status === "failed") {
          clearPoll();
          toast.error(jobError || "Briefing generation failed");
          setGenerating(false);
          setJob(null);
          return;
        }

        // Still running — schedule next poll, unless we've blown the cap.
        if (Date.now() > pollDeadline.current) {
          clearPoll();
          toast.message("Briefing still running", {
            description: "It's taking longer than expected. Refresh in a minute to check.",
          });
          setGenerating(false);
          setJob(null);
          return;
        }
        pollTimer.current = window.setTimeout(() => pollOnce(jobId), POLL_INTERVAL_MS);
      } catch (e: any) {
        console.error("Poll error:", e);
        // Don't tear down on a single transient error — try once more.
        if (Date.now() > pollDeadline.current) {
          clearPoll();
          toast.error(e?.message || "Lost connection to briefing job");
          setGenerating(false);
          setJob(null);
          return;
        }
        pollTimer.current = window.setTimeout(() => pollOnce(jobId), POLL_INTERVAL_MS);
      }
    },
    [clearPoll, load],
  );

  const generate = useCallback(async () => {
    setGenerating(true);
    setJob({ jobId: "", status: "queued", progress: 0, phase: "Queued" });
    try {
      const { data, error } = await supabase.functions.invoke("ceo-briefing", {
        body: { briefing_type: type },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const jobId = data?.job_id as string | undefined;
      if (!jobId) {
        // Backwards-compat: server returned a briefing synchronously.
        toast.success("Briefing generated");
        await load();
        setGenerating(false);
        setJob(null);
        return;
      }

      setJob({ jobId, status: "queued", progress: 0, phase: "Queued" });
      pollDeadline.current = Date.now() + POLL_MAX_MS;
      // Start polling immediately so the UI gets first-phase update fast.
      pollTimer.current = window.setTimeout(() => pollOnce(jobId), 1500);
    } catch (e: any) {
      toast.error(e?.message || "Failed to start briefing");
      setGenerating(false);
      setJob(null);
    }
  }, [type, load, pollOnce]);

  const cancelPolling = useCallback(() => {
    clearPoll();
    setGenerating(false);
    setJob(null);
    toast.message("Stopped checking", {
      description: "The briefing may still complete in the background.",
    });
  }, [clearPoll]);

  return {
    briefing,
    previous,
    loading,
    generating,
    generate,
    reload: load,
    job,
    cancelPolling,
  };
};
