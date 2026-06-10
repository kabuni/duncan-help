import { useState } from "react";
import { Loader2, Upload, Paperclip, X } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { toast } from "sonner";
import FeatureRequestsAdmin from "./FeatureRequestsAdmin";

const schema = z.object({
  title: z.string().trim().min(3, "Please provide a short title").max(120),
  description: z.string().trim().min(10, "Please describe the feature").max(2000),
  use_case: z.string().trim().max(1000).optional(),
  priority: z.enum(["Low", "Medium", "High"]),
});

const ALLOWED_EXT = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".docx", ".txt"];
const MAX_BYTES = 15 * 1024 * 1024;
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

export default function SettingsFeatureRequest() {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [useCase, setUseCase] = useState("");
  const [priority, setPriority] = useState<"Low" | "Medium" | "High">("Medium");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

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
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Request a Feature</h3>
        <p className="text-xs text-muted-foreground">Thanks — your request has been recorded.</p>
        <button
          onClick={() => setSubmitted(false)}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/60 transition-colors"
        >
          Submit another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Request a Feature</h3>
        <p className="text-xs text-muted-foreground">Tell us what you'd like Duncan to do next.</p>
      </div>

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

      <div className="flex justify-end pt-2">
        <button
          type="submit" disabled={submitting}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {submitting ? (uploadingIdx !== null ? `Uploading ${uploadingIdx + 1}/${files.length}…` : "Submitting…") : "Submit Request"}
        </button>
      </div>
    </form>
  );
}
