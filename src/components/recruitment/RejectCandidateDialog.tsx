import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, UserX } from "lucide-react";
import { toast } from "sonner";

function defaultBody(name: string, role: string) {
  const first = (name || "there").split(" ")[0];
  return `Hi ${first},

Thank you for applying for the ${role} position at Kabuni, and for the time you invested in the process.

After careful consideration, we've decided not to move forward with your application on this occasion. The decision was a close one, and it's no reflection on your ability.

We'll keep your details on file and would welcome you applying again for future roles that match your experience.

Wishing you the very best with your search.

Kind regards,
The Kabuni Team`;
}

export function RejectCandidateDialog({
  candidate,
  open,
  onOpenChange,
  onCompleted,
}: {
  candidate: { id: string; name: string; email: string | null; job_roles?: { title?: string } | null; role_title?: string | null } | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCompleted?: () => void;
}) {
  const roleTitle = candidate?.job_roles?.title || candidate?.role_title || "the role";
  const [subject, setSubject] = useState("Update on your application at Kabuni");
  const [body, setBody] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !candidate) return;
    setSubject(`Update on your application at Kabuni`);
    setBody(defaultBody(candidate.name, roleTitle));
    setSendEmail(!!candidate.email);
  }, [open, candidate, roleTitle]);

  const handleSubmit = async () => {
    if (!candidate) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("reject-candidate", {
        body: {
          candidate_id: candidate.id,
          subject,
          body,
          skip_email: !sendEmail,
        },
      });
      if (error) throw error;
      const d = data as any;
      if (d?.email?.sent) toast.success("Candidate rejected — email sent.");
      else if (d?.email?.skipped) toast.success("Candidate rejected (no email sent).");
      else if (d?.email?.error) toast.warning(`Candidate rejected — email not sent: ${d.email.error}`);
      else toast.success("Candidate rejected.");
      onCompleted?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Failed to reject: ${err.message || err}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserX className="h-4 w-4 text-destructive" /> Reject {candidate?.name}</DialogTitle>
          <DialogDescription>
            Marks this candidate as rejected. If enabled, sends the message below from your Gmail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2">
            <Checkbox id="send-email" checked={sendEmail} onCheckedChange={(v) => setSendEmail(!!v)} disabled={!candidate?.email} />
            <Label htmlFor="send-email" className="text-sm font-normal">
              Send rejection email to <span className="font-medium">{candidate?.email || "— no email on file —"}</span>
            </Label>
          </div>

          {sendEmail && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="subject">Subject</Label>
                <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="body">Message</Label>
                <Textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} rows={12} className="text-sm font-mono" />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={submitting}>
            {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Rejecting…</> : "Reject candidate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
