import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import KBDropzone from "@/components/kb/KBDropzone";
import KBScopePicker, { KBScope } from "@/components/kb/KBScopePicker";
import { KBCategorySelect, KBSubcategorySelect } from "@/components/kb/KBCategorySelect";
import KBTagsInput from "@/components/kb/KBTagsInput";
import KBRecentUploads from "@/components/kb/KBRecentUploads";
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

export default function KnowledgeBase() {
  const { user } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [scope, setScope] = useState<KBScope>("public");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const canSubmit = files.length > 0 && !uploading && (scope === "private" || (category && subcategory));

  const upload = async () => {
    if (!user) { toast.error("Not signed in"); return; }
    setUploading(true);
    try {
      for (const file of files) {
        const fileType = getFileType(file.name);
        // 1. Insert document row
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

        // 2. Upload to Azure
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

        // 3. Save blob refs and kick off processing
        await supabase.from("documents").update({
          blob_url: up.blob_url,
          blob_path: up.blob_path,
        }).eq("id", doc.id);

        supabase.functions.invoke("process-document", { body: { document_id: doc.id } });
        toast.success(`Queued: ${file.name}`);
      }

      // Reset form
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
    <AppLayout>
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold">Duncan Knowledge Base</h1>
          <p className="text-sm text-muted-foreground mt-1">Upload documents to train Duncan.</p>
        </header>

        <div className="rounded-lg border bg-card p-6 space-y-6">
          <div className="space-y-2">
            <Label>Files</Label>
            <KBDropzone files={files} onChange={setFiles} />
          </div>

          <div className="space-y-2">
            <Label>Scope</Label>
            <KBScopePicker value={scope} onChange={setScope} />
          </div>

          {scope === "public" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <KBCategorySelect value={category} onChange={(v) => { setCategory(v); setSubcategory(""); }} />
              </div>
              {category && (
                <div className="space-y-2">
                  <Label>Subcategory</Label>
                  <KBSubcategorySelect category={category} value={subcategory} onChange={setSubcategory} />
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Tags (optional)</Label>
            <KBTagsInput tags={tags} onChange={setTags} />
          </div>

          <div className="flex justify-end">
            <Button onClick={upload} disabled={!canSubmit}>
              {uploading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Upload to Duncan
            </Button>
          </div>
        </div>

        <KBRecentUploads refreshKey={refreshKey} />
      </div>
    </AppLayout>
  );
}
