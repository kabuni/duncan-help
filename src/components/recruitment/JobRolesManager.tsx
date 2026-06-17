import { useState, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Briefcase, Plus, Loader2, Trash2, Upload, FileText, Sparkles, Download, RotateCcw, AlertTriangle, XCircle, CheckCircle2, Undo2 } from "lucide-react";
import { toast } from "sonner";

const sanitizeStorageFileName = (fileName: string) => {
  const extension = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() ?? "" : "";
  const baseName = extension ? fileName.slice(0, -(extension.length + 1)) : fileName;

  const sanitizedBase = baseName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  const safeBase = sanitizedBase || "job-description";
  return extension ? `${safeBase}.${extension}` : safeBase;
};

export function JobRolesManager() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [expandedRoleId, setExpandedRoleId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [generatedJd, setGeneratedJd] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleExpand = (roleId: string) => {
    setExpandedRoleId((prev) => (prev === roleId ? null : roleId));
  };

  const { data: jobRoles, isLoading } = useQuery({
    queryKey: ["job-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_roles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch retry queue entries for position creation
  const { data: retryEntries } = useQuery({
    queryKey: ["hireflix-retry-queue-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hireflix_retry_queue")
        .select("*")
        .eq("operation", "create_position")
        .in("status", ["pending", "processing", "failed"]);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 15000,
  });

  // Build a map: job_role_id → retry entry
  const retryMap = new Map<string, any>();
  (retryEntries ?? []).forEach((entry: any) => {
    const roleId = entry.payload?.job_role_id;
    if (roleId) retryMap.set(roleId, entry);
  });

  const handleRetryPosition = async (roleId: string, roleTitle: string) => {
    try {
      const { data: roleData } = await supabase
        .from("job_roles")
        .select("competencies")
        .eq("id", roleId)
        .single();

      // Mark existing failed entry as completed before re-queuing
      const existing = retryMap.get(roleId);
      if (existing) {
        await supabase
          .from("hireflix_retry_queue")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", existing.id);
      }

      await supabase.from("hireflix_retry_queue").insert({
        operation: "create_position",
        payload: JSON.parse(JSON.stringify({
          job_role_id: roleId,
          title: roleTitle,
          competencies: roleData?.competencies || [],
        })),
        status: "pending",
        next_retry_at: new Date().toISOString(),
      });

      toast.success("Retry queued — position will be created shortly");
      queryClient.invalidateQueries({ queryKey: ["hireflix-retry-queue-roles"] });
    } catch (err: any) {
      toast.error("Failed to queue retry: " + err.message);
    }
  };

  const handleGenerateJd = async () => {
    if (!title.trim()) {
      toast.error("Enter a role title first");
      return;
    }
    setGenerating(true);
    try {
      const res = await supabase.functions.invoke("generate-jd", {
        body: { job_role_id: "preview", title: title.trim() },
      });
      if (res.error) throw res.error;
      const data = res.data as { full_text?: string };
      const jdText = data?.full_text;
      if (!jdText) throw new Error("No JD returned");
      setGeneratedJd(jdText);
      setDescription(jdText);
      toast.success("Job description generated! You can edit it before saving.");
    } catch (err: any) {
      toast.error("Failed to generate JD: " + err.message);
    } finally {
      setGenerating(false);
    }
  };

  const downloadJdPdf = (roleTitle: string, jdText: string) => {
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${roleTitle} - Job Description</title>
<style>
body { font-family: Georgia, serif; max-width: 700px; margin: 40px auto; padding: 20px; line-height: 1.6; color: #222; }
h1 { font-size: 24px; border-bottom: 2px solid #333; padding-bottom: 8px; }
h2 { font-size: 18px; margin-top: 24px; color: #444; }
ul { padding-left: 20px; }
li { margin-bottom: 4px; }
</style></head><body>
<h1>${roleTitle}</h1>
${jdText.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  .replace(/^### (.+)$/gm, '<h3>$1</h3>')
  .replace(/^- (.+)$/gm, '<li>$1</li>')
  .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
  .replace(/\n\n/g, '<br/><br/>')
  .replace(/\n/g, '<br/>')}
</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${roleTitle.replace(/\s+/g, "_")}_JD.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreate = async () => {
    if (!title.trim()) {
      toast.error("Role title is required");
      return;
    }
    if (!user) return;

    setSaving(true);
    try {
      let jdStoragePath: string | null = null;

      if (jdFile) {
        const ext = jdFile.name.split(".").pop()?.toLowerCase();
        if (!["pdf", "docx", "doc"].includes(ext || "")) {
          toast.error("JD must be a PDF, DOCX, or DOC file");
          setSaving(false);
          return;
        }
        jdStoragePath = `${Date.now()}_${sanitizeStorageFileName(jdFile.name)}`;
        const { error: uploadError } = await supabase.storage
          .from("job-descriptions")
          .upload(jdStoragePath, jdFile, { contentType: jdFile.type, upsert: false });
        if (uploadError) throw uploadError;
      }

      const insertData: any = {
        title: title.trim(),
        description: description.trim() || null,
        created_by: user.id,
      };
      if (jdStoragePath) {
        insertData.jd_storage_path = jdStoragePath;
      }

      const { data: newRole, error } = await supabase.from("job_roles").insert(insertData).select().single();
      if (error) throw error;

      if (jdStoragePath && newRole) {
        toast.info("Parsing JD for competencies...");
        try {
          const res = await supabase.functions.invoke("parse-jd-competencies", {
            body: { job_role_id: newRole.id, storage_path: jdStoragePath },
          });
          if (res.error) throw res.error;
          const data = res.data as { competencies?: any[] };
          const competencies = data?.competencies || [];
          toast.success(`Extracted ${competencies.length} competencies from JD`);
        } catch (err: any) {
          toast.warning("Role created but JD parsing failed: " + err.message);
        }
      }

      if (generatedJd && newRole) {
        try {
          const res = await supabase.functions.invoke("generate-jd", {
            body: { job_role_id: newRole.id, title: title.trim() },
          });
          if (res.error) throw res.error;
          // Competencies saved by edge function
        } catch {
          // Non-critical
        }
      }

      // Auto-create Hireflix position — queue retry on failure (non-blocking)
      if (newRole) {
        try {
          toast.info("Creating Hireflix interview position...");
          const { data: roleData } = await supabase
            .from("job_roles")
            .select("competencies")
            .eq("id", newRole.id)
            .single();

          const competencies = roleData?.competencies || [];

          const res = await supabase.functions.invoke("create-hireflix-position", {
            body: {
              job_role_id: newRole.id,
              title: title.trim(),
              competencies,
            },
          });
          if (res.error) throw res.error;
          const data = res.data as { success?: boolean; error?: string };
          if (data?.success) {
            toast.success(`Hireflix position created automatically`);
          } else {
            const exactError = data?.error || "Unknown issue";
            // Always queue for retry on failure
            const { error: queueError } = await supabase
              .from("hireflix_retry_queue")
              .insert({
                operation: "create_position",
                payload: JSON.parse(JSON.stringify({ job_role_id: newRole.id, title: title.trim(), competencies })),
                status: "pending",
                next_retry_at: new Date().toISOString(),
              });
            if (queueError) {
              console.error("Failed to queue Hireflix retry:", queueError);
            }
            toast.warning(`Hireflix: ${exactError}. Queued for retry.`);
          }
        } catch (err: any) {
          // Non-blocking: role is already saved, just warn about Hireflix
          console.error("Hireflix position creation failed:", err.message);
          try {
            const { error: queueError } = await supabase
              .from("hireflix_retry_queue")
              .insert({
                operation: "create_position",
                payload: JSON.parse(JSON.stringify({ job_role_id: newRole.id, title: title.trim(), competencies: [] })),
                status: "pending",
                next_retry_at: new Date().toISOString(),
              });
            if (queueError) {
              console.error("Failed to queue Hireflix retry:", queueError);
            }
          } catch {
            // Silent — role is saved, Hireflix is best-effort
          }
          toast.warning("Role saved. Hireflix position will be retried automatically.");
        }
      }

      toast.success(`Role "${title.trim()}" created`);
      setTitle("");
      setDescription("");
      setJdFile(null);
      setGeneratedJd(null);
      setAdding(false);
      queryClient.invalidateQueries({ queryKey: ["job-roles"] });
    } catch (err: any) {
      toast.error("Failed to create role: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, roleTitle: string, hireflixPositionId: string | null) => {
    try {
      const { error } = await supabase.from("job_roles").delete().eq("id", id);
      if (error) throw error;

      // Delete the corresponding Hireflix position
      if (hireflixPositionId) {
        try {
          const res = await supabase.functions.invoke("delete-hireflix-position", {
            body: { hireflix_position_id: hireflixPositionId },
          });
          if (res.error) throw res.error;
        } catch (err: any) {
          // Queue for retry silently
          try {
            await supabase.from("hireflix_retry_queue").insert({
              operation: "delete_position",
              payload: JSON.parse(JSON.stringify({ hireflix_position_id: hireflixPositionId })),
            });
          } catch {
            // Silent fallback
          }
          console.error("Hireflix delete error, queued for retry:", err.message);
        }
      }

      toast.success(`Role "${roleTitle}" deleted`);
      queryClient.invalidateQueries({ queryKey: ["job-roles"] });
    } catch (err: any) {
      toast.error("Failed to delete role: " + err.message);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Briefcase className="h-4 w-4" />
            Job Roles
          </CardTitle>
          <CardDescription>
            Define roles — Duncan auto-creates Hireflix positions and syncs interviews
          </CardDescription>
        </div>
        {!adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Role
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {adding && (
          <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
            <div className="space-y-1.5">
              <Label htmlFor="role-title">Role Title</Label>
              <Input
                id="role-title"
                placeholder="e.g. Interior Designer, Project Manager"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Gmail will be searched for emails with this title in the subject line
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Job Description</Label>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={handleGenerateJd} disabled={generating || !title.trim()}>
                  {generating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
                  {generating ? "Generating..." : "Generate JD"}
                </Button>
                <span className="text-xs text-muted-foreground">or</span>
                <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc" className="hidden" onChange={(e) => { setJdFile(e.target.files?.[0] || null); setGeneratedJd(null); }} />
                <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-1" />
                  {jdFile ? "Change File" : "Upload JD"}
                </Button>
                {jdFile && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <FileText className="h-3 w-3" /> {jdFile.name}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Generate a JD from the role title using AI, or upload your own (PDF/DOCX)</p>
            </div>

            {generatedJd && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Generated JD Preview</Label>
                  <Button type="button" size="sm" variant="ghost" onClick={() => downloadJdPdf(title, generatedJd)}>
                    <Download className="h-4 w-4 mr-1" /> Download
                  </Button>
                </div>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={8} className="text-xs font-mono" />
              </div>
            )}

            {!generatedJd && (
              <div className="space-y-1.5">
                <Label htmlFor="role-desc">Description (optional)</Label>
                <Textarea id="role-desc" placeholder="Brief description of the role..." value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
              </div>
            )}

            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreate} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Save Role
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setTitle(""); setDescription(""); setJdFile(null); setGeneratedJd(null); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : jobRoles && jobRoles.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Competencies</TableHead>
                <TableHead>JD</TableHead>
                <TableHead>Hireflix</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobRoles.map((role: any) => {
                const competencies = Array.isArray(role.competencies) ? role.competencies : [];
                const isExpanded = expandedRoleId === role.id;
                const visibleCompetencies = isExpanded ? competencies : competencies.slice(0, 3);
                const remainingCount = Math.max(competencies.length - 3, 0);
                const isLinked = !!role.hireflix_position_id;
                return (
                  <TableRow key={role.id}>
                    <TableCell className="font-medium">{role.title}</TableCell>
                    <TableCell>
                      {competencies.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {visibleCompetencies.map((c: any, i: number) => (
                            <Badge key={i} variant="outline" className="text-[10px]">
                              {typeof c === "string" ? c : c.name || c.title}
                            </Badge>
                          ))}
                          {competencies.length > 3 && (
                            <span
                              onClick={() => toggleExpand(role.id)}
                              className="inline-flex items-center rounded-md border border-border bg-secondary px-2 py-0.5 text-[10px] text-primary cursor-pointer"
                            >
                              {isExpanded ? "Show less" : `+${remainingCount}`}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {role.jd_storage_path ? (
                        <Badge variant="outline" className="text-[10px]">
                          <FileText className="h-3 w-3 mr-1" /> Uploaded
                        </Badge>
                      ) : role.description && role.description.length > 100 ? (
                        <Badge variant="outline" className="text-[10px]">
                          <Sparkles className="h-3 w-3 mr-1" /> Generated
                          <Button type="button" size="icon" variant="ghost" className="h-5 w-5 ml-1" onClick={() => downloadJdPdf(role.title, role.description)}>
                            <Download className="h-3 w-3" />
                          </Button>
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {isLinked ? (
                        <Badge variant="default" className="text-[10px] gap-1">
                          ✅ Linked
                        </Badge>
                      ) : (() => {
                        const retry = retryMap.get(role.id);
                        if (retry?.status === "failed") {
                          return (
                            <TooltipProvider delayDuration={200}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-1">
                                    <Badge variant="destructive" className="text-[10px] gap-1">
                                      <XCircle className="h-3 w-3" /> Failed
                                    </Badge>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-6 w-6"
                                      onClick={(e) => { e.stopPropagation(); handleRetryPosition(role.id, role.title); }}
                                    >
                                      <RotateCcw className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs text-xs">
                                  {retry.last_error || "Hireflix position creation failed after multiple attempts"}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          );
                        } else if (retry?.status === "pending" || retry?.status === "processing") {
                          return (
                            <Badge variant="secondary" className="text-[10px] gap-1">
                              <Loader2 className="h-3 w-3 animate-spin" /> Retrying...
                            </Badge>
                          );
                        } else {
                          return (
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground">
                                <AlertTriangle className="h-3 w-3" /> Not Linked
                              </Badge>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={(e) => { e.stopPropagation(); handleRetryPosition(role.id, role.title); }}
                              >
                                <RotateCcw className="h-3 w-3" />
                              </Button>
                            </div>
                          );
                        }
                      })()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={role.status === "active" ? "default" : "secondary"}>
                        {role.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(role.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(role.id, role.title, role.hireflix_position_id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No roles yet. Add a role to start matching CVs from Gmail.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
