import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Lightbulb, Loader2 } from "lucide-react";
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
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setTitle(""); setDescription(""); setUseCase(""); setPriority("Medium");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const parsed = schema.safeParse({ title, description, use_case: useCase, priority });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message ?? "Invalid input");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("feature_requests").insert({
      user_id: user.id,
      user_email: user.email,
      title: parsed.data.title,
      description: parsed.data.description,
      use_case: parsed.data.use_case || null,
      priority: parsed.data.priority,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
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
          className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose}
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
            <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
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
          </div>

          <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors">
              Cancel
            </button>
            <button
              type="submit" disabled={submitting}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Submit Request
            </button>
          </div>
        </motion.form>
      </div>
    </AnimatePresence>
  );
}
