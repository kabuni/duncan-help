import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

const PROJECT_TAGS = [
  "Lightning Strike Event",
  "Website",
  "K10 App",
  "School Integrations",
];

export function PromoteToWorkstreamDialog({
  open,
  onOpenChange,
  chatId,
  projectId: _projectId,
  defaultCardTitle,
  itemCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatId: string;
  projectId: string;
  defaultCardTitle?: string;
  itemCount: number;
}) {
  const navigate = useNavigate();
  const [tag, setTag] = useState<string>("none");
  const [cardTitle, setCardTitle] = useState(defaultCardTitle || "");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("promote-plan-to-workstream", {
        body: {
          chat_id: chatId,
          default_card_title: cardTitle.trim() || defaultCardTitle || "Plan",
          project_tag: tag === "none" ? null : tag,
          default_due_date: dueDate || null,
        },
      });
      if (error) throw error;
      const cards = (data as any)?.cards || [];
      const totalTasks = cards.reduce((s: number, c: any) => s + (c.tasks || 0), 0);
      toast.success(
        cards.length === 0
          ? "No new cards (all items were duplicates)"
          : `Created ${cards.length} card${cards.length === 1 ? "" : "s"} with ${totalTasks} task${totalTasks === 1 ? "" : "s"}`,
      );
      onOpenChange(false);
      // Offer quick navigate
      setTimeout(() => navigate("/workstreams"), 250);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't promote plan");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send plan to Workstreams</DialogTitle>
          <DialogDescription>
            Turn {itemCount} item{itemCount === 1 ? "" : "s"} into workstream cards and tasks. Items grouped under the same heading become tasks on one card.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="card-title" className="text-xs">Default card title (used for un-grouped items)</Label>
            <Input
              id="card-title"
              value={cardTitle}
              onChange={(e) => setCardTitle(e.target.value)}
              placeholder="Plan"
              className="h-9 text-sm"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Project tag</Label>
            <Select value={tag} onValueChange={setTag}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Choose project tag" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-sm">No tag</SelectItem>
                {PROJECT_TAGS.map((t) => (
                  <SelectItem key={t} value={t} className="text-sm">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="due" className="text-xs">Default due date (optional)</Label>
            <Input
              id="due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || itemCount === 0}>
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Creating…
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5 mr-1.5" /> Create cards
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
