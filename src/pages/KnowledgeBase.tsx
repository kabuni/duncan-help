import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, BookOpen, Upload as UploadIcon } from "lucide-react";
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

function StepLabel({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
        {n}
      </span>
      <Label className="text-sm font-medium">{children}</Label>
    </div>
  );
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
    <div className="mx-auto max-w-5xl px-6 py-10 space-y-10">
      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
          <BookOpen className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload documents to train Duncan. Company files are searchable by everyone; private files stay with you.
          </p>
        </div>
      </header>

      <section className="rounded-xl border bg-card">
        <div className="border-b px-6 py-4">
          <h2 className="text-sm font-semibold">New upload</h2>
          <p className="text-xs text-muted-foreground mt-0.5">PDF, DOCX, XLSX, TXT, CSV · max 25 MB each</p>
        </div>

        <div className="divide-y">
          <div className="px-6 py-5 space-y-3">
            <StepLabel n={1}>Files</StepLabel>
            <KBDropzone files={files} onChange={setFiles} />
          </div>

          <div className="px-6 py-5 space-y-3">
            <StepLabel n={2}>Visibility</StepLabel>
            <KBScopePicker value={scope} onChange={setScope} />
          </div>

          {scope === "public" && (
            <div className="px-6 py-5 space-y-3">
              <StepLabel n={3}>Categorise</StepLabel>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <KBCategorySelect value={category} onChange={(v) => { setCategory(v); setSubcategory(""); }} />
                {category && (
                  <KBSubcategorySelect category={category} value={subcategory} onChange={setSubcategory} />
                )}
              </div>
            </div>
          )}

          <div className="px-6 py-5 space-y-3">
            <StepLabel n={scope === "public" ? 4 : 3}>Tags <span className="text-xs font-normal text-muted-foreground">(optional)</span></StepLabel>
            <KBTagsInput tags={tags} onChange={setTags} />
          </div>
        </div>

        <div className="flex items-center justify-between border-t bg-muted/30 px-6 py-3 rounded-b-xl">
          <p className="text-xs text-muted-foreground">
            {files.length === 0
              ? "Add at least one file to continue."
              : `${files.length} file${files.length === 1 ? "" : "s"} ready.`}
          </p>
          <Button onClick={upload} disabled={!canSubmit} size="sm">
            {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UploadIcon className="h-4 w-4 mr-2" />}
            Upload
          </Button>
        </div>
      </section>

      <KBRecentUploads refreshKey={refreshKey} />

      {isAdmin && <KBObservability />}
    </div>
  );
}
