import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, X, CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import ReportedBugsAdmin from "./ReportedBugsAdmin";

const ISSUE_TYPES = [
  "Bug", "Retrieval Issue", "Incorrect Output", "Hallucination",
  "Tool Failure", "Integration Issue", "Performance Issue",
  "UI Issue", "Data Issue", "Other",
];

export default function SettingsBugReport() {
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const [form, setForm] = useState({
    title: "",
    issue_type: "Bug",
    description: "",
    expected_behavior: "",
    actual_behavior: "",
    affected_area: "",
  });

  const updateField = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFiles(Array.from(e.target.files));
  };

  const removeFile = (index: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== index));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim()) {
      toast.error("Title and Description are required");
      return;
    }

    setSubmitting(true);
    try {
      const attachmentPaths: string[] = [];
      for (const file of files) {
        const path = `${user?.id}/${Date.now()}-${file.name}`;
        const { error } = await supabase.storage.from("issue-attachments").upload(path, file);
        if (!error) attachmentPaths.push(path);
      }

      const { error } = await supabase.from("issues").insert({
        user_id: user?.id,
        user_email: user?.email ?? null,
        title: form.title.trim(),
        issue_type: form.issue_type,
        description: form.description.trim(),
        expected_behavior: form.expected_behavior.trim(),
        actual_behavior: form.actual_behavior.trim(),
        affected_area: form.affected_area.trim(),
        attachment_paths: attachmentPaths,
      } as any);

      if (error) throw error;
      setSubmitted(true);
      toast.success("Issue submitted — thank you!");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setForm({ title: "", issue_type: "Bug", description: "", expected_behavior: "", actual_behavior: "", affected_area: "" });
    setFiles([]);
    setSubmitted(false);
  };

  if (submitted) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
          <CheckCircle className="h-10 w-10 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Issue Submitted</h3>
          <p className="text-xs text-muted-foreground">Your feedback has been recorded.</p>
          <button onClick={resetForm} className="rounded-lg border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary transition-colors">
            Submit Another
          </button>
        </div>
        {isAdmin && (
          <div className="pt-6 border-t border-border space-y-3">
            <h4 className="text-sm font-semibold text-foreground">Reported Bugs</h4>
            <ReportedBugsAdmin />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Report a Bug</h3>
        <p className="text-xs text-muted-foreground">Help us improve Duncan</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Title *</Label>
          <Input value={form.title} onChange={(e) => updateField("title", e.target.value)} placeholder="Brief summary" className="h-9" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Type</Label>
          <Select value={form.issue_type} onValueChange={(v) => updateField("issue_type", v)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ISSUE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Description *</Label>
          <Textarea value={form.description} onChange={(e) => updateField("description", e.target.value)} placeholder="Describe the issue in detail" rows={3} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Expected Behavior</Label>
            <Textarea value={form.expected_behavior} onChange={(e) => updateField("expected_behavior", e.target.value)} placeholder="What should have happened" rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Actual Behavior</Label>
            <Textarea value={form.actual_behavior} onChange={(e) => updateField("actual_behavior", e.target.value)} placeholder="What actually happened" rows={2} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Affected Area</Label>
          <Input value={form.affected_area} onChange={(e) => updateField("affected_area", e.target.value)} placeholder="e.g. Recruitment, Wiki..." className="h-9" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Attachments</Label>
          <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-border px-4 py-2.5 text-xs text-muted-foreground hover:bg-secondary/40 transition-colors">
            <Upload className="h-3.5 w-3.5" />
            Choose files
            <input type="file" multiple className="hidden" onChange={handleFileChange} />
          </label>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {files.map((f, i) => (
                <span key={i} className="flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-[11px] text-foreground">
                  {f.name}
                  <button type="button" onClick={() => removeFile(i)}><X className="h-3 w-3 text-muted-foreground" /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit Issue"}
        </button>
      </form>

      {isAdmin && (
        <div className="pt-6 border-t border-border space-y-3">
          <h4 className="text-sm font-semibold text-foreground">Reported Bugs</h4>
          <ReportedBugsAdmin />
        </div>
      )}
    </div>
  );
}
