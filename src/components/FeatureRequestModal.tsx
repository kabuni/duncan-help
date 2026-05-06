import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Lightbulb, Loader2, Upload, Paperclip } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const schema = z.object({
  title: z.string().trim().min(3, "Please provide a short title").max(120),
  description: z.string().trim().min(10, "Please describe the feature").max(2000),
  use_case: z.string().trim().max(1000).optional(),
  priority: z.enum(["Low", "Medium", "High"]),
});

const ALLOWED_EXT = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".docx", ".txt"];
const MAX_BYTES = 15 * 1024 * 1024; // 15MB
const MAX_FILES = 5;

function sanitizeFileName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function validateFile(file: File): string | null {
  const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) return `Unsupported type: ${ext}`;
  if (file.size > MAX_BYTES) return `${file.name} exceeds 15MB`;
  return null;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function FeatureRequestModal({ open, onClose }: Props) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [useCase, setUseCase] = useState("");
  const [priority, setPriority] = useState<"Low" | "Medium" | "High">("Medium");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);

  const reset = () => {
    setTitle(""); setDescription(""); setUseCase(""); setPriority("Medium"); setFiles([]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const incoming = Array.from(e.target.files);
    const accepted: File[] = [];
    for (const f of incoming) {
      const err = validateFile(f);
      if (err) { toast.error(err); continue; }
      accepted.push(f);
    }
    setFiles((prev) => {
      const merged = [...prev, ...accepted];
      if (merged.length > MAX_FILES) {
        toast.error(`Max ${MAX_FILES} files`);
        return merged.slice(0, MAX_FILES);
      }
      return merged;
    });
    e.target.value = "";
  };

  const removeFile = (i: number) => setFiles((p) => p.filter((_, idx) => idx !== i));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const parsed = schema.safeParse({ title, description, use_case: useCase, priority });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message ?? "Invalid input");
      return;
    }
    setSubmitting(true);

    const { data: inserted, error } = await supabase.from("feature_requests").insert({
      user_id: user.id,
      user_email: user.email,
      title: parsed.data.title,
      description: parsed.data.description,
      use_case: parsed.data.use_case || null,
      priority: parsed.data.priority,
    }).select("id").single();

    if (error || !inserted) {
      setSubmitting(false);
      toast.error(error?.message ?? "Failed to submit");
      return;
    }

    // Upload attachments (best-effort; failures don't kill the request)
    if (files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        setUploadingIdx(i);
        const file = files[i];
        const safeName = sanitizeFileName(file.name);
        const path = `${user.id}/${inserted.id}/${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("feature-request-attachments")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) { toast.error(`Upload failed: ${file.name}`); continue; }

        const { error: rowErr } = await supabase.from("feature_request_attachments").insert({
          feature_request_id: inserted.id,
          storage_path: path,
          file_name: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
          uploaded_by: user.id,
        });
        if (rowErr) {
          await supabase.storage.from("feature-request-attachments").remove([path]);
          toast.error(`Failed to record: ${file.name}`);
        }
      }
      setUploadingIdx(null);
    }

    setSubmitting(false);
    toast.success("Feature request submitted");
    reset();
    onClose();
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[80] flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={submitting ? undefined : onClose}
        />
        <motion.form
          onSubmit={handleSubmit}
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.2 }}
          className="relative z-10 w-full max-w-lg mx-4 rounded-2xl border border-border bg-card shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-primary" />
              <h2 className="text-base font-semibold text-foreground">Request a Feature</h2>
            </div>
            <button type="button" onClick={onClose} disabled={submitting} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Title *</label>
              <input
                value={title} onChange={(e) => setTitle(e.target.value)}
                maxLength={120} required
                placeholder="Short summary of the feature"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Description *</label>
              <textarea
                value={description} onChange={(e) => setDescription(e.target.value)}
                maxLength={2000} required rows={4}
                placeholder="What should it do? How should it work?"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Use case (optional)</label>
              <textarea
                value={useCase} onChange={(e) => setUseCase(e.target.value)}
                maxLength={1000} rows={3}
                placeholder="What problem does this solve for you?"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Priority</label>
              <select
                value={priority} onChange={(e) => setPriority(e.target.value as "Low" | "Medium" | "High")}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Attachments (optional)</label>
              <label className="mt-1 flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground hover:bg-secondary/40 transition-colors">
                <Upload className="h-3.5 w-3.5" />
                Choose files (PDF, PNG, JPG, WEBP, DOCX, TXT · max 15MB · up to {MAX_FILES})
                <input
                  type="file" multiple className="hidden"
                  accept={ALLOWED_EXT.join(",")}
                  onChange={handleFileChange}
                  disabled={submitting}
                />
              </label>
              {files.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {files.map((f, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 rounded-md bg-secondary/60 px-2.5 py-1.5 text-[11px] text-foreground">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {uploadingIdx === i
                          ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
                          : <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />}
                        <span className="truncate">{f.name}</span>
                        <span className="text-muted-foreground shrink-0">({(f.size / 1024).toFixed(1)} KB)</span>
                      </div>
                      <button type="button" onClick={() => removeFile(i)} disabled={submitting} className="text-muted-foreground hover:text-foreground disabled:opacity-40">
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
            <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50">
              Cancel
            </button>
            <button
              type="submit" disabled={submitting}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {submitting ? (uploadingIdx !== null ? `Uploading ${uploadingIdx + 1}/${files.length}…` : "Submitting…") : "Submit Request"}
            </button>
          </div>
        </motion.form>
      </div>
    </AnimatePresence>
  );
}
