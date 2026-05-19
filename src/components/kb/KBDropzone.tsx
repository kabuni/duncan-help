import { useCallback, useRef, useState } from "react";
import { Upload, X, FileText, FileSpreadsheet, File as FileIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCEPTED_FILE_TYPES, MAX_FILE_SIZE, getFileType } from "@/lib/kbTaxonomy";
import { toast } from "sonner";

function fileIcon(name: string) {
  const t = getFileType(name);
  if (t === "pdf") return <FileText className="h-4 w-4 text-red-500" />;
  if (t === "docx") return <FileText className="h-4 w-4 text-blue-500" />;
  if (t === "xlsx") return <FileSpreadsheet className="h-4 w-4 text-emerald-500" />;
  if (t === "csv") return <FileSpreadsheet className="h-4 w-4 text-emerald-600" />;
  if (t === "txt") return <FileText className="h-4 w-4 text-muted-foreground" />;
  return <FileIcon className="h-4 w-4 text-muted-foreground" />;
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function KBDropzone({
  files,
  onChange,
}: {
  files: File[];
  onChange: (f: File[]) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    const valid: File[] = [];
    for (const f of arr) {
      const ext = getFileType(f.name);
      if (!ACCEPTED_FILE_TYPES.includes(ext as any)) {
        toast.error(`Unsupported file type: ${f.name}`);
        continue;
      }
      if (f.size > MAX_FILE_SIZE) {
        toast.error(`${f.name} exceeds 25MB`);
        continue;
      }
      valid.push(f);
    }
    if (valid.length) onChange([...files, ...valid]);
  }, [files, onChange]);

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
          dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        )}
      >
        <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm font-medium">Drag and drop files here, or click to browse</p>
        <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, XLSX, TXT, CSV — max 25MB each</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.xlsx,.txt,.csv"
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {files.map((f, idx) => (
            <li key={idx} className="flex items-center gap-3 rounded-md border bg-card px-3 py-2 text-sm">
              {fileIcon(f.name)}
              <span className="flex-1 truncate">{f.name}</span>
              <span className="text-xs text-muted-foreground">{fmtSize(f.size)}</span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, i) => i !== idx))}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
