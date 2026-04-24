import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  BorderStyle, Table, TableRow, TableCell, WidthType, ShadingType,
} from "https://esm.sh/docx@9.6.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ── Markdown table parser ── */
interface ParsedTable {
  headers: string[];
  rows: string[][];
}

function parseMarkdownTable(lines: string[], startIdx: number): { table: ParsedTable; endIdx: number } | null {
  // line[startIdx] should be header row: | col | col |
  const headerLine = lines[startIdx]?.trim();
  if (!headerLine?.startsWith("|")) return null;

  const sepLine = lines[startIdx + 1]?.trim();
  if (!sepLine || !/^\|[\s\-:|]+\|$/.test(sepLine)) return null;

  const parseCells = (line: string) =>
    line.split("|").slice(1, -1).map((c) => c.trim());

  const headers = parseCells(headerLine);
  const rows: string[][] = [];
  let i = startIdx + 2;
  while (i < lines.length && lines[i]?.trim().startsWith("|")) {
    rows.push(parseCells(lines[i].trim()));
    i++;
  }
  return { table: { headers, rows }, endIdx: i - 1 };
}

/* ── Inline formatting (bold, italic, emoji) ── */
function parseInlineFormatting(text: string, defaultSize = 22): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index), font: "Arial", size: defaultSize }));
    }
    if (match[1]) {
      runs.push(new TextRun({ text: match[1], bold: true, font: "Arial", size: defaultSize }));
    } else if (match[2]) {
      runs.push(new TextRun({ text: match[2], italics: true, font: "Arial", size: defaultSize }));
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex), font: "Arial", size: defaultSize }));
  }
  if (runs.length === 0) {
    runs.push(new TextRun({ text, font: "Arial", size: defaultSize }));
  }
  return runs;
}

/* ── Build a DOCX Table element ── */
function buildDocxTable(parsed: ParsedTable): Table {
  const colCount = parsed.headers.length;
  const tableWidth = 9026; // A4 content width in DXA (11906 - 2*1440)
  const colWidth = Math.floor(tableWidth / colCount);
  const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" };
  const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

  const headerRow = new TableRow({
    children: parsed.headers.map(
      (h) =>
        new TableCell({
          borders: cellBorders,
          width: { size: colWidth, type: WidthType.DXA },
          shading: { fill: "1E293B", type: ShadingType.CLEAR },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [
            new Paragraph({
              children: [new TextRun({ text: h, bold: true, font: "Arial", size: 20, color: "FFFFFF" })],
            }),
          ],
        })
    ),
  });

  const dataRows = parsed.rows.map(
    (row, rowIdx) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              borders: cellBorders,
              width: { size: colWidth, type: WidthType.DXA },
              shading: { fill: rowIdx % 2 === 0 ? "FFFFFF" : "F8FAFC", type: ShadingType.CLEAR },
              margins: { top: 50, bottom: 50, left: 100, right: 100 },
              children: [
                new Paragraph({
                  children: parseInlineFormatting(cell, 20),
                }),
              ],
            })
        ),
      })
  );

  return new Table({
    width: { size: tableWidth, type: WidthType.DXA },
    columnWidths: Array(colCount).fill(colWidth),
    rows: [headerRow, ...dataRows],
  });
}

/* ── Build entire document ── */
function buildDocxDocument(title: string, weekRange: string, content: string, companyName: string): Document {
  const now = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const lines = content.split("\n");
  const children: (Paragraph | Table)[] = [];

  // ── Header block ──
  children.push(
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, font: "Arial", size: 40, color: "0F172A" })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: weekRange, font: "Arial", size: 24, color: "475569" })],
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `Generated on ${now} by Duncan AI`, font: "Arial", size: 18, color: "94A3B8" })],
      spacing: { after: 300 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "0F172A", space: 12 } },
    }),
    new Paragraph({ spacing: { after: 200 }, children: [] })
  );

  // ── Content ──
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // Skip empty lines (but add spacing after sections)
    if (!trimmed) {
      i++;
      continue;
    }

    // Table detection
    if (trimmed.startsWith("|")) {
      const result = parseMarkdownTable(lines, i);
      if (result) {
        children.push(new Paragraph({ spacing: { before: 120 }, children: [] }));
        children.push(buildDocxTable(result.table));
        children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
        i = result.endIdx + 1;
        continue;
      }
    }

    // Headings — with generous spacing and bottom border for H1
    if (trimmed.startsWith("### ")) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun({ text: trimmed.slice(4), bold: true, font: "Arial", size: 22, color: "334155" })],
        spacing: { before: 280, after: 120 },
      }));
    } else if (trimmed.startsWith("## ")) {
      // Add a visual separator before H2 sections
      children.push(new Paragraph({ spacing: { before: 160 }, children: [] }));
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: trimmed.slice(3), bold: true, font: "Arial", size: 26, color: "1E293B" })],
        spacing: { before: 360, after: 160 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1", space: 6 } },
      }));
    } else if (trimmed.startsWith("# ")) {
      children.push(new Paragraph({ spacing: { before: 200 }, children: [] }));
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: trimmed.slice(2), bold: true, font: "Arial", size: 30, color: "0F172A" })],
        spacing: { before: 400, after: 200 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "94A3B8", space: 8 } },
      }));
    }
    // Horizontal rules (---)
    else if (/^-{3,}$/.test(trimmed) || /^\*{3,}$/.test(trimmed)) {
      children.push(new Paragraph({
        spacing: { before: 200, after: 200 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "E2E8F0", space: 4 } },
        children: [],
      }));
    }
    // Bullets
    else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      children.push(new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: parseInlineFormatting(trimmed.slice(2)),
        spacing: { before: 40, after: 40 },
      }));
    }
    // Numbered list
    else if (/^\d+\.\s/.test(trimmed)) {
      children.push(new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: parseInlineFormatting(trimmed.replace(/^\d+\.\s/, "")),
        spacing: { before: 40, after: 40 },
      }));
    }
    // Regular paragraph
    else {
      children.push(new Paragraph({
        children: parseInlineFormatting(trimmed),
        spacing: { before: 80, after: 80 },
      }));
    }

    i++;
  }

  // ── Footer ──
  children.push(new Paragraph({ spacing: { before: 500 }, children: [] }));
  children.push(new Paragraph({
    border: { top: { style: BorderStyle.SINGLE, size: 1, color: "E2E8F0", space: 10 } },
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({ text: `Confidential — ${companyName} — Generated by Duncan Intelligence System`, font: "Arial", size: 16, color: "94A3B8", italics: true }),
    ],
  }));

  return new Document({
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [{
            level: 0,
            format: "bullet" as any,
            text: "\u2022",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          }],
        },
        {
          reference: "numbers",
          levels: [{
            level: 0,
            format: "decimal" as any,
            text: "%1.",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          }],
        },
      ],
    },
    styles: {
      default: {
        document: { run: { font: "Arial", size: 22 } },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children,
    }],
  });
}

/* ── Edge function handler ── */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { title, week_range, content, company_name } = body;

    if (!content || !title) {
      return new Response(JSON.stringify({ error: "title and content are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const weekRange = week_range || "Weekly Executive Summary";
    const companyName = company_name || "Kabuni";

    // Generate DOCX
    const doc = buildDocxDocument(title, weekRange, content, companyName);
    const docxBuffer = await Packer.toBuffer(doc);

    // Build filename
    const safeTitle = title.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "_").slice(0, 60);
    const dateStr = new Date().toISOString().split("T")[0];
    const fileName = `${safeTitle}_${dateStr}.docx`;
    const blobPath = `executive-summaries/${fileName}`;

    // Upload to Azure Blob Storage
    const formData = new FormData();
    const file = new File([docxBuffer], fileName, {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    formData.append("file", file);
    formData.append("action", "upload");
    formData.append("path", "executive-summaries");

    const uploadRes = await fetch(`${supabaseUrl}/functions/v1/azure-blob-api`, {
      method: "POST",
      headers: { Authorization: authHeader },
      body: formData,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`Upload failed: ${err}`);
    }

    const uploadData = await uploadRes.json();
    const downloadUrl = `${supabaseUrl}/functions/v1/azure-blob-api?action=download&path=${encodeURIComponent(blobPath)}`;

    return new Response(
      JSON.stringify({
        success: true,
        file_name: fileName,
        blob_path: blobPath,
        blob_url: uploadData.url,
        download_url: downloadUrl,
        message: `Executive summary "${title}" has been generated as a Word document and saved.`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Generate exec summary error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
