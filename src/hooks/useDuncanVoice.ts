import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScribe, CommitStrategy } from "@elevenlabs/react";
import { getAuthToken } from "@/lib/authStorage";
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
  send: (input: string, mode?: any, attachments?: any[], opts?: { voiceMode?: boolean }) => void;
}

interface Options {
  chat: ChatLike;
  voiceId?: string;
  speed?: number;
  enabled: boolean; // overlay open
}

const API_BASE = import.meta.env.VITE_API_BASE_URL as string;
const TTS_URL = `${API_BASE}/elevenlabs-tts`;
const TOKEN_URL = `${API_BASE}/elevenlabs-scribe-token`;

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

  // Keep cached access token in sync — just reads from authStorage
  useEffect(() => {
    tokenRef.current = getAuthToken();
  }, []);

  const getToken = useCallback((): string => {
    if (tokenRef.current) return tokenRef.current;
    tokenRef.current = getAuthToken();
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
      let token = getToken();
      const doFetch = (t: string) =>
        fetch(TTS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${t}`,
            "ngrok-skip-browser-warning": "1",
          },
          body: JSON.stringify({ text: next, voice_id: voiceId }),
        });
      let resp = await doFetch(token);
      if (resp.status === 401) {
        tokenRef.current = null;
        token = getToken();
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
    const { sentences, remainder } = extractSpeakable(fresh, {
      eager: chat.isLoading,
      minSoftLen: 60,
    });
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
    minSpeechDurationMs: 200,
    minSilenceDurationMs: 350,
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
        chat.send(text, "general", safeAttachments, { voiceMode: true });
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

      const authToken = getAuthToken();
      if (!authToken) throw new Error("Not signed in");
      tokenRef.current = authToken;
      const resp = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
          "ngrok-skip-browser-warning": "1",
        },
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Voice token failed: ${errText || resp.status}`);
      }
      const respData = await resp.json();
      // FastAPI returns { signed_url }, Supabase edge returned { token }
      const token = respData.signed_url || respData.token;
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

      if (!hasWarmedRef.current) {
        hasWarmedRef.current = true;
        fetch(TTS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
            "ngrok-skip-browser-warning": "1",
          },
          body: JSON.stringify({ text: ".", voice_id: voiceId }),
        })
          .then((r) => r.body?.cancel().catch(() => {}))
          .catch(() => {});
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Duncan voice] start failed", e);
      setError(msg);
      toast.error(msg);
      throw e;
    }
  }, [scribe, voiceId, speed]);

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
