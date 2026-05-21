import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Paperclip, X, FileText, Image as ImageIcon, Loader2, Mic, Square } from "lucide-react";
import type { ChatAttachment } from "@/hooks/useNormanChat";
import { invokeEdge } from "@/lib/edgeApi";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import AudioWaveform from "@/components/chat/AudioWaveform";
import VoiceModeButton from "@/components/chat/VoiceModeButton";

interface ChatInputProps {
  onSubmit: (input: string, attachments: ChatAttachment[]) => void;
  isLoading: boolean;
  extractionProgress?: string | null;
  onVoiceToggle?: () => void;
  isVoiceActive?: boolean;
  placeholder?: string;
  hideFooter?: boolean;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = [
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "application/pdf",
  "text/plain", "text/csv", "text/markdown",
  "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ChatInput({ onSubmit, isLoading, extractionProgress, placeholder, hideFooter, onVoiceToggle, isVoiceActive }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, []);

  useEffect(() => { resizeTextarea(); }, [input, resizeTextarea]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsProcessing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const newAttachments: ChatAttachment[] = [];
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_SIZE) {
          console.warn(`File ${file.name} exceeds 10MB limit`);
          continue;
        }
        const base64 = await fileToBase64(file);
        const previewUrl = file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined;

        // Stage PDFs in the docusign-staging bucket so Duncan can send them for e-signature.
        let stagingPath: string | undefined;
        if (file.type === "application/pdf" && user) {
          const safeName = file.name.replace(/[^\w.\-]+/g, "_");
          const path = `${user.id}/${Date.now()}-${safeName}`;
          const { error: upErr } = await supabase.storage
            .from("docusign-staging")
            .upload(path, file, { contentType: "application/pdf", upsert: false });
          if (upErr) {
            console.warn(`Could not stage PDF for e-sign: ${upErr.message}`);
          } else {
            stagingPath = path;
          }
        }

        newAttachments.push({
          name: file.name,
          type: file.type || "application/octet-stream",
          base64,
          previewUrl,
          stagingPath,
        });
      }
      setAttachments((prev) => [...prev, ...newAttachments].slice(0, 5));
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => {
      const removed = prev[index];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleSubmit = useCallback(() => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;
    onSubmit(input.trim() || "Analyze the attached file(s)", attachments);
    setInput("");
    setAttachments([]);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.focus();
      }
    });
  }, [input, attachments, isLoading, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const stopRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      setActiveStream(stream);
      audioChunksRef.current = [];

      const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
      const mimeType = mimeCandidates.find((t) => (window as any).MediaRecorder?.isTypeSupported?.(t)) || "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        setIsRecording(false);
        setActiveStream(null);
        mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;

        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size === 0) return;
        setIsTranscribing(true);
        try {
          const buf = await blob.arrayBuffer();
          // Chunked base64 to avoid stack overflow
          let binary = "";
          const bytes = new Uint8Array(buf);
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
          }
          const base64 = btoa(binary);
          const data = await invokeEdge<{ text?: string; error?: string }>("transcribe-audio", {
            body: {
              audio: base64,
              mimeType: recorder.mimeType || "audio/webm",
            },
          });
          const text = data?.text?.trim();
          if (text) {
            setInput((prev) => (prev ? prev + (prev.endsWith(" ") ? "" : " ") + text : text));
            requestAnimationFrame(() => textareaRef.current?.focus());
          } else {
            toast.error("No speech detected");
          }
        } catch (err: any) {
          console.error("Transcription failed:", err);
          toast.error(err?.message || "Transcription failed");
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start();
      setIsRecording(true);
    } catch (err: any) {
      console.error("Mic error:", err);
      if (err?.name === "NotAllowedError") {
        toast.error("Microphone access denied");
      } else {
        toast.error("Could not start recording");
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.state !== "inactive" && mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="relative z-10 border-t border-border px-8 py-4">
      <div className="mx-auto max-w-3xl">
        {/* Extraction progress indicator */}
        {extractionProgress && (
          <div className="flex items-center gap-2 mb-3 text-xs text-primary animate-pulse">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>{extractionProgress}</span>
          </div>
        )}

        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {attachments.map((att, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-xs">
                {att.previewUrl ? (
                  <img src={att.previewUrl} alt={att.name} className="h-6 w-6 rounded object-cover" />
                ) : att.type.startsWith("image/") ? (
                  <ImageIcon className="h-4 w-4 text-primary" />
                ) : (
                  <FileText className="h-4 w-4 text-primary" />
                )}
                <span className="max-w-[120px] truncate text-foreground">{att.name}</span>
                <button onClick={() => removeAttachment(i)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Live waveform while recording / transcribing */}
        {(isRecording || isTranscribing) && (
          <div className="mb-3 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 animate-fade-in">
            {isRecording ? (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
              </span>
            ) : (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
            )}
            <span className="text-[11px] font-mono text-muted-foreground shrink-0">
              {isRecording ? "Listening" : "Transcribing"}
            </span>
            <AudioWaveform stream={activeStream} className="h-8 flex-1" />
            {isRecording && (
              <button
                type="button"
                onClick={stopRecording}
                className="shrink-0 rounded-md bg-destructive px-2 py-1 text-[11px] font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Stop
              </button>
            )}
          </div>
        )}

        <div
          className="flex items-end gap-3 rounded-xl border border-border bg-card px-4 py-3 focus-within:border-primary/40 focus-within:glow-primary-sm transition-all duration-300"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          {/* Attach button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading || isProcessing}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-30"
            title="Attach file"
          >
            {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_TYPES.join(",")}
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />

          <textarea
            ref={textareaRef}
            placeholder={placeholder ?? "Ask Duncan anything…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            rows={1}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-50 resize-none overflow-y-auto"
            style={{ maxHeight: 160 }}
          />

          <button
            type="button"
            onClick={handleSubmit}
            disabled={(!input.trim() && attachments.length === 0) || isLoading}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Send className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isLoading || isTranscribing}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all ${
              isRecording
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90 animate-pulse"
                : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80"
            } disabled:opacity-30`}
            title={isRecording ? "Stop & transcribe" : "Record voice"}
          >
            {isTranscribing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isRecording ? (
              <Square className="h-3.5 w-3.5" />
            ) : (
              <Mic className="h-3.5 w-3.5" />
            )}
          </button>
          {onVoiceToggle && (
            <VoiceModeButton onClick={onVoiceToggle} active={isVoiceActive} />
          )}
        </div>
        {!hideFooter && (
          <p className="mt-2 text-center text-[10px] font-mono text-muted-foreground/40">
            Shift+Enter for new line · Attach files for analysis · Tap mic to dictate · Powered by Duncan AI Engine
          </p>
        )}
      </div>
    </div>
  );
}
