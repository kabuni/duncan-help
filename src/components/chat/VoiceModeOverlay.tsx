import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MicOff, Volume2, VolumeX, Square } from "lucide-react";
import duncanAvatar from "@/assets/duncan-avatar.jpeg";
import { useDuncanVoice } from "@/hooks/useDuncanVoice";

interface ChatLike {
  messages: { role: "user" | "assistant"; content: string }[];
  isLoading: boolean;
  send: (input: string, mode?: any, attachments?: any[]) => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  chat: ChatLike;
  voiceId?: string;
  speed?: number;
}

export default function VoiceModeOverlay({ open, onClose, chat, voiceId, speed }: Props) {
  const voice = useDuncanVoice({ chat, voiceId, speed, enabled: open });

  // Auto-start when opened
  useEffect(() => {
    if (!open) return;
    voice.start().catch(() => {
      // error toast is handled inside the hook
      onClose();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const lastAssistant = [...chat.messages].reverse().find((m) => m.role === "assistant");

  if (!open) return null;

  const stateLabel: Record<string, string> = {
    idle: "Connecting…",
    listening: "Listening",
    thinking: "Thinking",
    speaking: "Speaking",
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[80] flex flex-col bg-background/95 backdrop-blur-md"
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                voice.state === "listening"
                  ? "bg-primary animate-pulse"
                  : voice.state === "speaking"
                    ? "bg-primary"
                    : voice.state === "thinking"
                      ? "bg-amber-500 animate-pulse"
                      : "bg-muted-foreground"
              }`}
            />
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Voice mode · {stateLabel[voice.state] ?? voice.state}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary"
            title="End voice mode"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Avatar */}
        <div className="flex flex-1 flex-col items-center justify-center px-6 gap-8">
          <motion.div
            animate={
              voice.state === "speaking"
                ? { scale: [1, 1.05, 1] }
                : voice.state === "listening"
                  ? { scale: [1, 1.02, 1] }
                  : { scale: 1 }
            }
            transition={{
              duration: voice.state === "speaking" ? 0.6 : 1.4,
              repeat: voice.state === "idle" ? 0 : Infinity,
            }}
            className="relative h-44 w-44 rounded-full overflow-hidden border-4 border-primary/30 shadow-xl"
          >
            <img
              src={duncanAvatar}
              alt="Duncan"
              className="h-full w-full object-cover object-[50%_30%] scale-150"
            />
            {(voice.state === "listening" || voice.state === "speaking") && (
              <span className="absolute inset-0 rounded-full ring-4 ring-primary/30 animate-ping" />
            )}
          </motion.div>

          {/* Live transcript */}
          <div className="w-full max-w-xl text-center min-h-[2.5rem]">
            {voice.partialTranscript ? (
              <p className="text-base text-foreground/90 italic">
                "{voice.partialTranscript}"
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {voice.state === "listening"
                  ? "Speak whenever you're ready."
                  : voice.state === "thinking"
                    ? "Duncan is thinking…"
                    : voice.state === "speaking"
                      ? "Duncan is speaking. Start talking to interrupt."
                      : "Connecting voice…"}
              </p>
            )}
          </div>

          {/* Last reply preview */}
          {lastAssistant && (
            <div className="w-full max-w-xl rounded-xl border border-border bg-card px-5 py-4 max-h-48 overflow-y-auto">
              <p className="mb-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Duncan
              </p>
              <p className="text-sm leading-6 text-foreground/90 whitespace-pre-wrap">
                {lastAssistant.content}
              </p>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-3 px-6 py-6 border-t border-border">
          <button
            type="button"
            onClick={voice.toggleMute}
            className={`flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-xs font-medium transition-colors ${
              voice.muted
                ? "bg-destructive/10 text-destructive border-destructive/30"
                : "bg-card text-foreground hover:bg-secondary"
            }`}
            title={voice.muted ? "Unmute Duncan's voice" : "Mute Duncan's voice"}
          >
            {voice.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            {voice.muted ? "Voice muted" : "Mute Duncan"}
          </button>
          <button
            type="button"
            onClick={voice.interrupt}
            disabled={voice.state !== "speaking"}
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-xs font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Stop Duncan from speaking"
          >
            <Square className="h-3.5 w-3.5" />
            Interrupt
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
          >
            <MicOff className="h-3.5 w-3.5" />
            End voice mode
          </button>
        </div>

        {voice.error && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
            {voice.error}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
