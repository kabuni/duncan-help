import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScribe, CommitStrategy } from "@elevenlabs/react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { extractSpeakable, sanitizeForSpeech } from "@/lib/ttsTextSanitizer";

type VoiceState = "idle" | "listening" | "thinking" | "speaking";

const FILLER_BLACKLIST = new Set([
  "uh","um","hmm","mm","mhm","ah","oh","eh","huh",
  "ok","okay","yeah","yep","nope","hi","hey","bye",
  "[music]","[noise]","[silence]"
]);

function isLikelyNoise(raw: string): boolean {
  const t = raw.toLowerCase().replace(/[.,!?…]+$/g, "").trim();
  if (!t) return true;
  if (FILLER_BLACKLIST.has(t)) return true;
  const words = t.split(/\s+/);
  if (words.length < 2 && t.length < 6) return true;
  if (/^(.)\1+$/.test(t.replace(/\s/g, ""))) return true;
  return false;
}

interface ChatLike {
  messages: { role: "user" | "assistant"; content: string }[];
  isLoading: boolean;
  send: (input: string, mode?: any, attachments?: any[]) => void;
}

interface Options {
  chat: ChatLike;
  voiceId?: string;
  speed?: number;
  enabled: boolean; // overlay open
}

const TTS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-tts`;
const TOKEN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-scribe-token`;

export function useDuncanVoice({ chat, voiceId, speed, enabled }: Options) {
  const [state, setState] = useState<VoiceState>("idle");
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // TTS playback queue ----------------------------------------------------
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const mutedRef = useRef(muted);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  const lastCommitRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const tokenRef = useRef<string | null>(null);
  const hasWarmedRef = useRef(false);

  // Keep cached access token in sync with auth state
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      tokenRef.current = session?.access_token ?? null;
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  const getToken = useCallback(async (): Promise<string> => {
    if (tokenRef.current) return tokenRef.current;
    const { data: { session } } = await supabase.auth.getSession();
    tokenRef.current = session?.access_token ?? null;
    return tokenRef.current ?? "";
  }, []);


  const stopAudio = useCallback(() => {
    queueRef.current = [];
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    playingRef.current = false;
  }, []);

  const playNext = useCallback(async () => {
    if (playingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      // queue empty
      if (!chat.isLoading) {
        setState((s) => (s === "speaking" ? "listening" : s));
      }
      return;
    }
    playingRef.current = true;
    setState("speaking");
    try {
      let token = await getToken();
      const doFetch = (t: string) =>
        fetch(TTS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${t}`,
          },
          body: JSON.stringify({ text: next, voiceId, speed }),
        });
      let resp = await doFetch(token);
      if (resp.status === 401) {
        // Token may have rotated — refresh once and retry
        tokenRef.current = null;
        token = await getToken();
        resp = await doFetch(token);
      }
      if (!resp.ok) throw new Error(`TTS ${resp.status}`);

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        playingRef.current = false;
        playNext();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        playingRef.current = false;
        playNext();
      };
      await audio.play();
    } catch (e) {
      console.warn("[Duncan voice] TTS chunk failed", e);
      playingRef.current = false;
      playNext();
    }
  }, [chat.isLoading, voiceId, speed]);

  const enqueueSentence = useCallback(
    (sentence: string) => {
      if (mutedRef.current) return;
      const clean = sanitizeForSpeech(sentence);
      if (!clean) return;
      queueRef.current.push(clean);
      playNext();
    },
    [playNext]
  );

  // Watch the latest assistant message and stream sentences into TTS queue
  const lastSpokenIndexRef = useRef(0);
  const lastAssistantMsgIdRef = useRef<number>(-1);
  useEffect(() => {
    if (!enabled) return;
    const idx = chat.messages.length - 1;
    const last = chat.messages[idx];
    if (!last || last.role !== "assistant") return;

    if (idx !== lastAssistantMsgIdRef.current) {
      // new assistant turn
      lastAssistantMsgIdRef.current = idx;
      lastSpokenIndexRef.current = 0;
    }

    const fresh = last.content.slice(lastSpokenIndexRef.current);
    const { sentences, remainder } = extractSentences(fresh);
    if (sentences.length > 0) {
      sentences.forEach(enqueueSentence);
      lastSpokenIndexRef.current = last.content.length - remainder.length;
    }

    // when streaming finished, flush any remainder as final sentence
    if (!chat.isLoading && remainder.trim().length > 0) {
      enqueueSentence(remainder);
      lastSpokenIndexRef.current = last.content.length;
    }
  }, [chat.messages, chat.isLoading, enabled, enqueueSentence]);

  // Track state vs chat loading
  useEffect(() => {
    if (!enabled) return;
    if (chat.isLoading) {
      setState((s) => (s === "speaking" ? s : "thinking"));
    } else if (!playingRef.current && queueRef.current.length === 0) {
      setState((s) => (s === "idle" ? s : "listening"));
    }
  }, [chat.isLoading, enabled]);

  // Scribe (ElevenLabs realtime STT) -------------------------------------
  const scribe = useScribe({
    modelId: "scribe_v2_realtime",
    commitStrategy: CommitStrategy.VAD,
    vadThreshold: 0.6,
    minSpeechDurationMs: 300,
    noVerbatim: true,
    languageCode: "eng",
    onPartialTranscript: (data: any) => {
      const text = (data?.text || "").trim();
      if (!text || isLikelyNoise(text)) return;
      // Barge-in: only if substantive speech detected
      if (playingRef.current) {
        stopAudio();
        setState("listening");
      }
    },
    onCommittedTranscript: (data: any) => {
      const text = (data?.text || "").trim();
      if (!text || isLikelyNoise(text)) {
        console.debug("[Duncan voice] dropped noise commit:", text);
        return;
      }
      const now = Date.now();
      if (text === lastCommitRef.current.text && now - lastCommitRef.current.at < 1500) {
        console.debug("[Duncan voice] dropped duplicate commit:", text);
        return;
      }
      lastCommitRef.current = { text, at: now };
      stopAudio();
      lastSpokenIndexRef.current = 0;
      lastAssistantMsgIdRef.current = -1;
      setState("thinking");
      try {
        const safeAttachments: any[] = [];
        chat.send(text, "general", safeAttachments);
      } catch (e) {
        console.error("[Duncan voice] send failed", e);
        toast.error("Couldn't send your message to Duncan.");
      }
    },
    onError: (err: any) => {
      console.error("[Duncan voice] scribe error", err);
      const msg = err?.message || "Voice connection error";
      setError(msg);
      toast.error(msg);
    },
  });

  const partialTranscript = (scribe as any)?.partialTranscript || "";

  // Lifecycle
  const start = useCallback(async () => {
    setError(null);
    try {
      // mic permission
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // release immediately — scribe.connect grabs its own
      stream.getTracks().forEach((t) => t.stop());

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");
      const resp = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Voice token failed: ${errText || resp.status}`);
      }
      const { token } = await resp.json();
      if (!token) throw new Error("No voice token returned");

      await scribe.connect({
        token,
        microphone: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      setState("listening");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Duncan voice] start failed", e);
      setError(msg);
      toast.error(msg);
      throw e;
    }
  }, [scribe]);

  const stop = useCallback(async () => {
    stopAudio();
    try {
      await scribe.disconnect();
    } catch {
      /* noop */
    }
    setState("idle");
  }, [scribe, stopAudio]);

  const interrupt = useCallback(() => {
    stopAudio();
    setState("listening");
  }, [stopAudio]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      if (next) stopAudio();
      return next;
    });
  }, [stopAudio]);

  // Cleanup on unmount / disable
  useEffect(() => {
    if (!enabled) {
      stop();
    }
    return () => {
      stopAudio();
      try { scribe.disconnect(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return useMemo(
    () => ({
      state,
      partialTranscript,
      muted,
      error,
      isConnected: (scribe as any)?.isConnected ?? false,
      start,
      stop,
      interrupt,
      toggleMute,
    }),
    [state, partialTranscript, muted, error, scribe, start, stop, interrupt, toggleMute]
  );
}
