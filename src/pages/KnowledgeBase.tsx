import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, BookOpen, Upload as UploadIcon, BarChart3, FileStack } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import KBDropzone from "@/components/kb/KBDropzone";
import KBScopePicker, { KBScope } from "@/components/kb/KBScopePicker";
import { KBCategorySelect, KBSubcategorySelect } from "@/components/kb/KBCategorySelect";
import KBTagsInput from "@/components/kb/KBTagsInput";
import KBRecentUploads from "@/components/kb/KBRecentUploads";
import KBObservability from "@/components/kb/KBObservability";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { getFileType } from "@/lib/kbTaxonomy";
import { Label } from "@/components/ui/label";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result as string;
      resolve(r.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function KnowledgeBase() {
  const { user } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [scope, setScope] = useState<KBScope>("public");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { isAdmin } = useIsAdmin();

  const canSubmit = files.length > 0 && !uploading && (scope === "private" || (category && subcategory));

  const upload = async () => {
    if (!user) { toast.error("Not signed in"); return; }
    setUploading(true);
    try {
      for (const file of files) {
        const fileType = getFileType(file.name);
        const { data: doc, error: insErr } = await supabase
          .from("documents")
          .insert({
            title: file.name.replace(/\.[^.]+$/, ""),
            file_name: file.name,
            file_type: fileType,
            scope,
            category: scope === "public" ? category : null,
            subcategory: scope === "public" ? subcategory : null,
            tags,
            blob_url: "",
            blob_path: "",
            status: "processing",
            owner_id: user.id,
          })
          .select("id")
          .single();
        if (insErr || !doc) throw insErr ?? new Error("Failed to create document");

        const file_base64 = await fileToBase64(file);
        const { data: up, error: upErr } = await supabase.functions.invoke("upload-to-azure", {
          body: { file_base64, document_id: doc.id, user_id: user.id, scope, filename: file.name },
        });
        if (upErr || !up?.blob_url) {
          await supabase.from("documents").update({
            status: "failed",
            error_message: (upErr as any)?.message || "Upload failed",
          }).eq("id", doc.id);
          toast.error(`Upload failed: ${file.name}`);
          continue;
        }

        await supabase.from("documents").update({
          blob_url: up.blob_url,
          blob_path: up.blob_path,
        }).eq("id", doc.id);

        supabase.functions.invoke("process-document", { body: { document_id: doc.id } });
        toast.success(`Queued: ${file.name}`);
      }

      setFiles([]);
      setTags([]);
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Upload error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
          <BookOpen className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload documents to train Duncan, manage what's indexed, and monitor retrieval quality.
          </p>
        </div>
      </header>

      <Tabs defaultValue="documents" className="space-y-6">
        <TabsList>
          <TabsTrigger value="documents" className="gap-2"><FileStack className="h-4 w-4" />Documents</TabsTrigger>
          {isAdmin && <TabsTrigger value="analytics" className="gap-2"><BarChart3 className="h-4 w-4" />Analytics</TabsTrigger>}
          <TabsTrigger value="settings" className="gap-2"><SettingsIcon className="h-4 w-4" />Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="space-y-6">
          {/* Compact upload card */}
          <section className="rounded-xl border bg-card">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold">Upload documents</h2>
                <p className="text-xs text-muted-foreground mt-0.5">PDF, DOCX, XLSX, TXT, CSV · max 25 MB each</p>
              </div>
              <Button onClick={upload} disabled={!canSubmit} size="sm">
                {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UploadIcon className="h-4 w-4 mr-2" />}
                Upload{files.length > 0 ? ` (${files.length})` : ""}
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 p-5">
              <div className="lg:col-span-3">
                <KBDropzone files={files} onChange={setFiles} />
              </div>

              <div className="lg:col-span-2 space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Visibility</Label>
                  <KBScopePicker value={scope} onChange={setScope} />
                </div>

                {scope === "public" && (
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Category</Label>
                    <div className="space-y-2">
                      <KBCategorySelect value={category} onChange={(v) => { setCategory(v); setSubcategory(""); }} />
                      {category && (
                        <KBSubcategorySelect category={category} value={subcategory} onChange={setSubcategory} />
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tags <span className="normal-case text-[10px] text-muted-foreground/70">(optional)</span></Label>
                  <KBTagsInput tags={tags} onChange={setTags} />
                </div>
              </div>
            </div>
          </section>

          <KBRecentUploads refreshKey={refreshKey} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="analytics" className="space-y-6">
            <KBObservability />
          </TabsContent>
        )}

        <TabsContent value="settings">
          <section className="rounded-xl border bg-card p-12 text-center">
            <SettingsIcon className="h-8 w-8 mx-auto mb-3 text-muted-foreground/60" />
            <h3 className="text-sm font-semibold">Knowledge Base settings</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              Retention rules, chunk sizing, embedding model, and re-index controls will live here. Nothing to configure yet.
            </p>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
