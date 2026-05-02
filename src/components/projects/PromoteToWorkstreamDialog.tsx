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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  const [mode, setMode] = useState<"single_card" | "by_group">("single_card");
  const [cardTitle, setCardTitle] = useState(defaultCardTitle || "");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("promote-plan-to-workstream", {
        body: {
          chat_id: chatId,
          mode,
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
          <DialogTitle>Also send to Workstreams?</DialogTitle>
          <DialogDescription>
            These {itemCount} item{itemCount === 1 ? "" : "s"} are already saved as project tasks. This step <strong>additionally</strong> creates workstream cards so the wider team can track them on the kanban. Assignees and due dates are preserved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">Card structure</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as any)} className="space-y-1">
              <div className="flex items-start gap-2 rounded-md border border-border px-2.5 py-2">
                <RadioGroupItem value="single_card" id="m-single" className="mt-0.5" />
                <label htmlFor="m-single" className="text-xs leading-snug cursor-pointer">
                  <span className="font-medium">One card for the project</span>
                  <span className="block text-muted-foreground">All items become tasks under a single card. Best when working on one initiative.</span>
                </label>
              </div>
              <div className="flex items-start gap-2 rounded-md border border-border px-2.5 py-2">
                <RadioGroupItem value="by_group" id="m-group" className="mt-0.5" />
                <label htmlFor="m-group" className="text-xs leading-snug cursor-pointer">
                  <span className="font-medium">One card per group</span>
                  <span className="block text-muted-foreground">Items grouped under the same heading become tasks on their own card.</span>
                </label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-1">
            <Label htmlFor="card-title" className="text-xs">
              {mode === "single_card" ? "Card title" : "Default card title (for un-grouped items)"}
            </Label>
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
            <Label htmlFor="due" className="text-xs">Default due date (used for items without one)</Label>
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
