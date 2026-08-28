import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

const sanitizeStorageFileName = (fileName: string) =>
  fileName
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(-120);

interface JobRoleOption {
  id: string;
  title: string;
  status?: string | null;
}

interface AddCandidateDialogProps {
  jobRoles: JobRoleOption[];
  defaultRoleId?: string | null;
  onAdded?: (roleId: string) => void;
}

export function AddCandidateDialog({ jobRoles, defaultRoleId, onAdded }: AddCandidateDialogProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [roleId, setRoleId] = useState<string>(defaultRoleId ?? "");
  const [cvFile, setCvFile] = useState<File | null>(null);

  useEffect(() => {
    if (open) setRoleId(defaultRoleId ?? "");
  }, [open, defaultRoleId]);

  const activeRoles = jobRoles.filter((r) => r.status === "active" || !r.status);

  const reset = () => {
    setName("");
    setEmail("");
    setLinkedin("");
    setCvFile(null);
  };

  const submit = async () => {
    if (!name.trim()) return toast.error("Candidate name is required.");
    if (!roleId) return toast.error("Select a role for this candidate.");

    setSaving(true);
    try {
      let cvStoragePath: string | null = null;
      if (cvFile) {
        const path = `${Date.now()}_${sanitizeStorageFileName(cvFile.name)}`;
        const { error: uploadError } = await supabase.storage
          .from("cvs")
          .upload(path, cvFile, { contentType: cvFile.type || "application/octet-stream", upsert: false });
        if (uploadError) throw uploadError;
        cvStoragePath = path;
      }

      const { error } = await supabase.from("candidates").insert({
        name: name.trim(),
        email: email.trim() || null,
        linkedin_url: linkedin.trim() || null,
        job_role_id: roleId,
        cv_storage_path: cvStoragePath,
        attachment_filename: cvFile?.name ?? null,
        source: "manual",
        status: cvStoragePath ? "parsed" : "manual",
      });
      if (error) throw error;

      toast.success(`${name.trim()} added to the role.`);
      reset();
      setOpen(false);
      onAdded?.(roleId);
    } catch (err: any) {
      toast.error("Failed to add candidate: " + (err.message || "unknown error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" />
        <span className="hidden sm:inline">Add Candidate</span>
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add candidate to a role</DialogTitle>
          <DialogDescription>
            Manually add a candidate. Uploading a CV lets Duncan score values and competencies.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cand-name">Full name *</Label>
            <Input id="cand-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cand-email">Email</Label>
            <Input
              id="cand-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
            />
            <p className="text-[11px] text-muted-foreground">Required later to send a Hireflix interview invite.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cand-linkedin">LinkedIn / portfolio URL</Label>
            <Input
              id="cand-linkedin"
              value={linkedin}
              onChange={(e) => setLinkedin(e.target.value)}
              placeholder="https://linkedin.com/in/…"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Role *</Label>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                {activeRoles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cand-cv">CV (optional)</Label>
            <Input
              id="cand-cv"
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              onChange={(e) => setCvFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Add candidate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
