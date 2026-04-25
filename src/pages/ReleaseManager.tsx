import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { useReleases, useCreateRelease, useUpdateRelease, usePublishRelease, useDeleteRelease, Release } from "@/hooks/useReleases";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Send, Trash2, Eye, Pencil, Rocket, Bug, Sparkles, FileText } from "lucide-react";
import { format } from "date-fns";
import { Navigate } from "react-router-dom";

const changeTypeIcons: Record<string, React.ReactNode> = {
  feature: <Rocket className="h-3.5 w-3.5 text-primary" />,
  improvement: <Sparkles className="h-3.5 w-3.5 text-amber-500" />,
  fix: <Bug className="h-3.5 w-3.5 text-destructive" />,
  other: <FileText className="h-3.5 w-3.5 text-muted-foreground" />,
};

const changeTypeBadge: Record<string, string> = {
  feature: "bg-primary/10 text-primary",
  improvement: "bg-amber-500/10 text-amber-600",
  fix: "bg-destructive/10 text-destructive",
  other: "bg-muted text-muted-foreground",
};

export default function ReleaseManager() {
  const { isAdmin, isLoading: rolesLoading } = useIsAdmin();
  const { data: releases = [], isLoading } = useReleases();
  const createRelease = useCreateRelease();
  const updateRelease = useUpdateRelease();
  const publishRelease = usePublishRelease();
  const deleteRelease = useDeleteRelease();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRelease, setEditingRelease] = useState<Release | null>(null);
  const [previewRelease, setPreviewRelease] = useState<Release | null>(null);

  // Form state
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [changes, setChanges] = useState<{ type: string; description: string }[]>([{ type: "feature", description: "" }]);

  if (rolesLoading) return <AppLayout><div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div></AppLayout>;
  if (!isAdmin) return <Navigate to="/" replace />;

  const resetForm = () => {
    setVersion("");
    setTitle("");
    setSummary("");
    setChanges([{ type: "feature", description: "" }]);
    setEditingRelease(null);
  };

  const openEdit = (r: Release) => {
    setEditingRelease(r);
    setVersion(r.version);
    setTitle(r.title);
    setSummary(r.summary);
    setChanges(r.changes.length ? r.changes : [{ type: "feature", description: "" }]);
    setDialogOpen(true);
  };

  const handleSave = () => {
    const cleanChanges = changes.filter((c) => c.description.trim());
    if (editingRelease) {
      updateRelease.mutate({ id: editingRelease.id, version, title, summary, changes: cleanChanges } as any);
    } else {
      createRelease.mutate({ version, title, summary, changes: cleanChanges });
    }
    setDialogOpen(false);
    resetForm();
  };

  const addChange = () => setChanges([...changes, { type: "feature", description: "" }]);
  const removeChange = (i: number) => setChanges(changes.filter((_, idx) => idx !== i));
  const updateChange = (i: number, field: "type" | "description", val: string) =>
    setChanges(changes.map((c, idx) => (idx === i ? { ...c, [field]: val } : c)));

  const drafts = releases.filter((r) => r.status === "draft");
  const published = releases.filter((r) => r.status === "published");

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto py-6 sm:py-8 px-4 sm:px-6 space-y-6 sm:space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">Release Manager</h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">Draft, preview, and publish Duncan release notes</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button className="w-full sm:w-auto"><Plus className="h-4 w-4 mr-2" />New Release</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingRelease ? "Edit Release" : "Create Release"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Version</Label>
                    <Input placeholder="v1.2.0" value={version} onChange={(e) => setVersion(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Title</Label>
                    <Input placeholder="Document Intelligence" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Summary</Label>
                  <Textarea placeholder="Brief description of this release..." value={summary} onChange={(e) => setSummary(e.target.value)} className="mt-1" rows={3} />
                </div>
                <div>
                  <Label className="text-xs">Changes</Label>
                  <div className="space-y-2 mt-2">
                    {changes.map((c, i) => (
                      <div key={i} className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-start">
                        <Select value={c.type} onValueChange={(v) => updateChange(i, "type", v)}>
                          <SelectTrigger className="w-full sm:w-[130px] h-9 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="feature">🚀 Feature</SelectItem>
                            <SelectItem value="improvement">✨ Improvement</SelectItem>
                            <SelectItem value="fix">🐛 Fix</SelectItem>
                            <SelectItem value="other">📋 Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input placeholder="Description..." value={c.description} onChange={(e) => updateChange(i, "description", e.target.value)} className="flex-1 h-9 text-sm" />
                        {changes.length > 1 && (
                          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => removeChange(i)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={addChange} className="text-xs"><Plus className="h-3 w-3 mr-1" />Add Change</Button>
                  </div>
                </div>
                <Button onClick={handleSave} disabled={!version || !title} className="w-full">
                  {editingRelease ? "Update" : "Create"} Release
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <>
            {/* Drafts */}
            {drafts.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground mb-3">Drafts</h2>
                <div className="space-y-3">
                  {drafts.map((r) => (
                    <Card key={r.id} className="border-dashed">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="text-xs font-mono">{r.version}</Badge>
                              <Badge variant="secondary" className="text-xs">Draft</Badge>
                            </div>
                            <h3 className="font-semibold text-foreground">{r.title}</h3>
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{r.summary}</p>
                            {r.changes.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {r.changes.map((c, i) => (
                                  <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${changeTypeBadge[c.type] || changeTypeBadge.other}`}>
                                    {changeTypeIcons[c.type] || changeTypeIcons.other}
                                    {c.description.length > 40 ? c.description.slice(0, 40) + "…" : c.description}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button variant="ghost" size="icon" onClick={() => setPreviewRelease(r)} title="Preview">
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => openEdit(r)} title="Edit">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => publishRelease.mutate(r.id)}
                              disabled={publishRelease.isPending}
                              className="ml-1"
                            >
                              {publishRelease.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                              Publish
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => deleteRelease.mutate(r.id)} className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {/* Published */}
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground mb-3">Published Releases</h2>
              {published.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No published releases yet</p>
              ) : (
                <div className="space-y-3">
                  {published.map((r) => (
                    <Card key={r.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="text-xs font-mono">{r.version}</Badge>
                              <Badge className="text-xs bg-primary/10 text-primary border-0">Published</Badge>
                              {r.published_at && (
                                <span className="text-[11px] text-muted-foreground">{format(new Date(r.published_at), "dd MMM yyyy")}</span>
                              )}
                            </div>
                            <h3 className="font-semibold text-foreground">{r.title}</h3>
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{r.summary}</p>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => setPreviewRelease(r)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {/* Preview Dialog */}
        <Dialog open={!!previewRelease} onOpenChange={(open) => { if (!open) setPreviewRelease(null); }}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Release Preview</DialogTitle>
            </DialogHeader>
            {previewRelease && <ReleasePreview release={previewRelease} />}
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}

function ReleasePreview({ release }: { release: Release }) {
  const features = release.changes.filter((c) => c.type === "feature");
  const improvements = release.changes.filter((c) => c.type === "improvement");
  const fixes = release.changes.filter((c) => c.type === "fix");
  const other = release.changes.filter((c) => !["feature", "improvement", "fix"].includes(c.type));

  const Section = ({ title, emoji, items }: { title: string; emoji: string; items: typeof features }) =>
    items.length > 0 ? (
      <div>
        <h4 className="text-sm font-semibold text-foreground mb-2">{emoji} {title}</h4>
        <ul className="space-y-1.5">
          {items.map((c, i) => (
            <li key={i} className="text-sm text-muted-foreground flex gap-2">
              <span className="text-muted-foreground/50">•</span>
              {c.description}
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <div className="space-y-6 mt-4">
      <div className="rounded-lg bg-gradient-to-r from-primary to-primary/80 p-6 text-primary-foreground">
        <h2 className="text-xl font-bold">Duncan {release.version}</h2>
        <p className="text-sm opacity-85 mt-1">{release.title}</p>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{release.summary}</p>
      <Section title="New Features" emoji="🚀" items={features} />
      <Section title="Improvements" emoji="✨" items={improvements} />
      <Section title="Bug Fixes" emoji="🐛" items={fixes} />
      <Section title="Other Changes" emoji="📋" items={other} />
      {release.published_at && (
        <p className="text-xs text-muted-foreground/60">Published {format(new Date(release.published_at), "dd MMM yyyy 'at' HH:mm")}</p>
      )}
    </div>
  );
}
