import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, Upload, X } from "lucide-react";

const ISSUE_TYPES = [
  "Bug", "Retrieval Issue", "Incorrect Output", "Hallucination",
  "Tool Failure", "Integration Issue", "Performance Issue",
  "UI Issue", "Data Issue", "Other",
];


const FeedbackIssues = () => {
  const { user } = useAuth();
  const { toast } = useToast();
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

  const updateField = (field: string, value: string | number) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFiles(Array.from(e.target.files));
  };

  const removeFile = (index: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== index));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim()) {
      toast({ title: "Required fields", description: "Title and Description are required.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      // Upload attachments
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
      toast({ title: "Issue submitted", description: "Thank you for your feedback." });
    } catch (err: any) {
      toast({ title: "Submission failed", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setForm({
      title: "", issue_type: "Bug", description: "",
      expected_behavior: "", actual_behavior: "", affected_area: "",
    });
    setFiles([]);
    setSubmitted(false);
  };

  if (submitted) {
    return (
      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <Card className="max-w-md w-full text-center">
          <CardContent className="pt-8 pb-8 space-y-4">
            <CheckCircle className="h-12 w-12 text-primary mx-auto" />
            <h2 className="text-xl font-semibold text-foreground">Issue Submitted</h2>
            <p className="text-sm text-muted-foreground">Your feedback has been recorded. We'll look into it.</p>
            <Button onClick={resetForm} variant="outline">Submit Another</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto p-4 sm:p-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Report an Issue</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Help us improve Duncan by reporting bugs, incorrect outputs, or any other issues.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Issue Title *</Label>
              <Input id="title" placeholder="Brief summary of the issue" value={form.title} onChange={(e) => updateField("title", e.target.value)} />
            </div>

            {/* Issue Type */}
            <div className="space-y-2">
              <Label>Issue Type</Label>
              <Select value={form.issue_type} onValueChange={(v) => updateField("issue_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ISSUE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Textarea id="description" placeholder="Describe the issue in detail" rows={4} value={form.description} onChange={(e) => updateField("description", e.target.value)} />
            </div>


            {/* Expected / Actual */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="expected">Expected Behavior</Label>
                <Textarea id="expected" placeholder="What should have happened" rows={3} value={form.expected_behavior} onChange={(e) => updateField("expected_behavior", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="actual">Actual Behavior</Label>
                <Textarea id="actual" placeholder="What actually happened" rows={3} value={form.actual_behavior} onChange={(e) => updateField("actual_behavior", e.target.value)} />
              </div>
            </div>

            {/* Affected Area */}
            <div className="space-y-2">
              <Label htmlFor="area">Affected Area / Module</Label>
              <Input id="area" placeholder="e.g. Prompt Engine, Recruitment, Wiki..." value={form.affected_area} onChange={(e) => updateField("affected_area", e.target.value)} />
            </div>


            {/* Attachments */}
            <div className="space-y-2">
              <Label>Attachments (optional)</Label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer rounded-md border border-input bg-background px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors">
                  <Upload className="h-4 w-4" />
                  Choose files
                  <input type="file" multiple className="hidden" onChange={handleFileChange} />
                </label>
              </div>
              {files.length > 0 && (
                <div className="space-y-1 mt-2">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate max-w-[200px]">{f.name}</span>
                      <button type="button" onClick={() => removeFile(i)}><X className="h-3 w-3" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Submitting..." : "Submit Issue"}
            </Button>
          </form>
        </div>
  </main>
  );
};

export default FeedbackIssues;
