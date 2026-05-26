import { useState } from "react";
import { useReleases, Release } from "@/hooks/useReleases";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Rocket, Sparkles, Bug, FileText, Mail, Send, Eye, Pencil } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

const changeTypeConfig: Record<string, { icon: React.ReactNode; label: string; className: string }> = {
  feature: { icon: <Rocket className="h-3.5 w-3.5" />, label: "Feature", className: "bg-primary/10 text-primary" },
  improvement: { icon: <Sparkles className="h-3.5 w-3.5" />, label: "Improvement", className: "bg-amber-500/10 text-amber-600" },
  fix: { icon: <Bug className="h-3.5 w-3.5" />, label: "Fix", className: "bg-destructive/10 text-destructive" },
  other: { icon: <FileText className="h-3.5 w-3.5" />, label: "Other", className: "bg-muted text-muted-foreground" },
};

export default function WhatsNew() {
  const { data: releases = [], isLoading } = useReleases("published");
  const { data: drafts = [] } = useReleases("draft");
  const { isAdmin } = useIsAdmin();
  const currentDraft = drafts[0];

  return (
    <>
      <div className="max-w-3xl mx-auto py-6 sm:py-8 px-4 sm:px-6">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">What's New</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">See what's changed in each Duncan release</p>
        </div>

        {isAdmin && (currentDraft ? <DraftBanner draft={currentDraft} /> : <NoDraftHint />)}

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : releases.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-16">No releases published yet.</p>
        ) : (
          <div className="relative">
            <div className="absolute left-[19px] top-4 bottom-4 w-px bg-border" />
            <div className="space-y-8">
              {releases.map((release, index) => (
                <ReleaseCard key={release.id} release={release} isLatest={index === 0} isAdmin={isAdmin} />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function DraftBanner({ draft }: { draft: Release }) {
  const [publishing, setPublishing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const qc = useQueryClient();
  const changeCount = Array.isArray(draft.changes) ? draft.changes.length : 0;

  const handlePublish = async () => {
    if (changeCount === 0) {
      toast.error("Draft has no changes yet");
      return;
    }
    setPublishing(true);
    try {
      const { data, error } = await supabase.functions.invoke("finalize-release", {
        body: { releaseId: draft.id },
      });
      if (error) throw error;
      toast.success(`Published v${data?.version ?? draft.version}`);
      qc.invalidateQueries({ queryKey: ["releases"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to publish");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="mb-6 rounded-lg border border-primary/30 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Current draft <span className="font-mono text-xs text-muted-foreground">v{draft.version}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {changeCount} change{changeCount === 1 ? "" : "s"} ready — title & summary auto-generated on publish
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)} className="gap-1.5">
          <Eye className="h-3.5 w-3.5" />
          Review
        </Button>
        <Button size="sm" variant="outline" asChild className="gap-1.5">
          <Link to="/releases">
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Link>
        </Button>
        <Button size="sm" onClick={handlePublish} disabled={publishing || changeCount === 0} className="gap-1.5">
          {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Publish
        </Button>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Draft Preview</DialogTitle>
          </DialogHeader>
          <DraftPreview release={draft} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DraftPreview({ release }: { release: Release }) {
  const features = release.changes.filter((c) => c.type === "feature");
  const improvements = release.changes.filter((c) => c.type === "improvement");
  const fixes = release.changes.filter((c) => c.type === "fix");
  const other = release.changes.filter((c) => !["feature", "improvement", "fix"].includes(c.type));

  return (
    <div className="space-y-6 mt-4">
      <div className="rounded-lg bg-gradient-to-r from-primary to-primary/80 p-6 text-primary-foreground">
        <h2 className="text-xl font-bold">Duncan v{release.version}</h2>
        {release.title && <p className="text-sm opacity-85 mt-1">{release.title}</p>}
        {!release.title && <p className="text-sm opacity-75 mt-1 italic">Title auto-generated on publish</p>}
      </div>
      {release.summary ? (
        <p className="text-sm text-muted-foreground leading-relaxed">{release.summary}</p>
      ) : (
        <p className="text-sm text-muted-foreground italic">Summary auto-generated on publish</p>
      )}
      <ChangeSection title="New Features" type="feature" items={features} />
      <ChangeSection title="Improvements" type="improvement" items={improvements} />
      <ChangeSection title="Bug Fixes" type="fix" items={fixes} />
      <ChangeSection title="Other" type="other" items={other} />
    </div>
  );
}

function NoDraftHint() {
  return (
    <div className="mb-6 rounded-lg border border-dashed border-border bg-muted/30 p-4">
      <p className="text-sm text-foreground font-medium">No draft release yet</p>
      <p className="text-xs text-muted-foreground mt-1">
        Tell Duncan in chat about a fix or feature you've shipped (e.g. <span className="italic">"Just fixed the publish button on What's New"</span>) and a draft will appear here ready to publish.
      </p>
    </div>
  );
}

function ReleaseCard({ release, isLatest, isAdmin }: { release: Release; isLatest: boolean; isAdmin: boolean }) {
  const [sending, setSending] = useState(false);
  const features = release.changes.filter((c) => c.type === "feature");
  const improvements = release.changes.filter((c) => c.type === "improvement");
  const fixes = release.changes.filter((c) => c.type === "fix");
  const other = release.changes.filter((c) => !["feature", "improvement", "fix"].includes(c.type));

  const handleSendNotification = async () => {
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ gmail?: { sent?: number } }>("send-release-emails", {
        body: { releaseId: release.id },
      });
      if (error) throw error;
      const gmail = data?.gmail;
      toast.success(`Notification sent to ${gmail?.sent ?? 0} users`);
    } catch (err: any) {
      toast.error(err.message || "Failed to send notifications");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="relative flex gap-4">
      <div className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 ${isLatest ? "border-primary bg-primary/10" : "border-border bg-background"}`}>
        <Rocket className={`h-4 w-4 ${isLatest ? "text-primary" : "text-muted-foreground"}`} />
      </div>

      <div className="flex-1 pb-2">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <Badge variant="outline" className="font-mono text-xs">{release.version}</Badge>
          {isLatest && <Badge className="bg-primary/10 text-primary border-0 text-xs">Latest</Badge>}
          {release.published_at && (
            <span className="text-xs text-muted-foreground">{format(new Date(release.published_at), "dd MMM yyyy")}</span>
          )}
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground ml-auto"
              onClick={handleSendNotification}
              disabled={sending}
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
              Send Notification
            </Button>
          )}
        </div>

        <h3 className="text-lg font-semibold text-foreground mb-2">{release.title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">{release.summary}</p>

        <div className="space-y-4">
          <ChangeSection title="New Features" type="feature" items={features} />
          <ChangeSection title="Improvements" type="improvement" items={improvements} />
          <ChangeSection title="Bug Fixes" type="fix" items={fixes} />
          <ChangeSection title="Other" type="other" items={other} />
        </div>
      </div>
    </div>
  );
}

function ChangeSection({ title, type, items }: { title: string; type: string; items: { type: string; description: string }[] }) {
  if (items.length === 0) return null;
  const config = changeTypeConfig[type] || changeTypeConfig.other;

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${config.className}`}>
          {config.icon}
          {title}
        </span>
      </div>
      <ul className="space-y-1.5 ml-1">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-muted-foreground flex gap-2 items-start">
            <span className="text-muted-foreground/40 mt-0.5">•</span>
            <span>{item.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}