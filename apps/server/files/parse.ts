import Papa from "papaparse";
import mammoth from "mammoth";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { extractText, getDocumentProxy } from "unpdf";
import {
  fileLimits,
  type ParsedFile,
} from "../../../packages/protocol/files.ts";

export function sniff(bytes: Buffer): ParsedFile["kind"] {
  if (bytes.subarray(0, 5).toString() === "%PDF-") return "pdf";
  if (bytes.readUInt32LE(0) === 0x04034b50) return "docx";
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (
    Array.from(text).some((c) => c.charCodeAt(0) < 32 && !"\t\r\n".includes(c))
  )
    throw new Error("This file type is not supported.");
  return "csv";
}

function csv(bytes: Buffer): ParsedFile {
  const result = Papa.parse<string[]>(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    { skipEmptyLines: "greedy" },
  );
  if (result.errors.length)
    throw new Error("This CSV has invalid rows or quotes.");
  const [headers, ...raw] = result.data;
  if (
    !headers?.length ||
    headers.length > fileLimits.columns ||
    raw.length > fileLimits.rows
  )
    throw new Error("This CSV exceeds the row or column limit.");
  if (
    headers.some((s) => !s.trim()) ||
    new Set(headers).size !== headers.length ||
    raw.some((row) => row.length !== headers.length)
  )
    throw new Error(
      "This CSV needs unique column names and matching row widths.",
    );
  const numeric = (s: string) =>
    /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(s) &&
    Number.isFinite(Number(s));
  const columns: Extract<ParsedFile, { kind: "csv" }>["columns"] = headers.map(
    (name, i) => {
      const values = raw.map((row) => row[i]).filter((s) => s !== "");
      const type =
        values.length && values.every(numeric)
          ? "number"
          : values.length &&
              values.every(
                (s) =>
                  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)),
              )
            ? "date"
            : new Set(values).size <= 20
              ? "category"
              : "text";
      return { name, type };
    },
  );
  return {
    kind: "csv",
    columns,
    rows: raw.map((row) =>
      row.map((s, i) =>
        s === "" ? null : columns[i].type === "number" ? Number(s) : s,
      ),
    ),
  };
}

export function checkDocxZip(bytes: Buffer) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This DOCX is not a supported ZIP file.");
  const count = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16),
    expanded = 0;
  if (
    bytes.readUInt16LE(eocd + 4) ||
    bytes.readUInt16LE(eocd + 6) ||
    count === 65535 ||
    bytes.readUInt16LE(eocd + 8) !== count
  )
    throw new Error("Multi-volume and ZIP64 DOCX files are not supported.");
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > eocd || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("This DOCX has an invalid ZIP directory.");
    const flags = bytes.readUInt16LE(offset + 8),
      method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 24),
      nameSize = bytes.readUInt16LE(offset + 28);
    const end =
      offset +
      46 +
      nameSize +
      bytes.readUInt16LE(offset + 30) +
      bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    if (
      end > eocd ||
      local + 30 > offset ||
      bytes.readUInt32LE(local) !== 0x04034b50 ||
      flags & 1 ||
      ![0, 8].includes(method)
    )
      throw new Error("This DOCX has unsupported ZIP entries.");
    if (bytes.readUInt32LE(local + 22) !== size && !(flags & 8))
      throw new Error("This DOCX has inconsistent ZIP sizes.");
    expanded += size;
    if (expanded > fileLimits.expandedBytes)
      throw new Error("This DOCX expands beyond the local size limit.");
    const name = bytes
      .subarray(offset + 46, offset + 46 + nameSize)
      .toString("utf8");
    if (names.has(name) || name.includes("..") || name.startsWith("/"))
      throw new Error("This DOCX has invalid ZIP paths.");
    names.add(name);
    offset = end;
  }
  if (!names.has("word/document.xml") || !names.has("[Content_Types].xml"))
    throw new Error("This ZIP is not a DOCX document.");
}

type HtmlNode = DefaultTreeAdapterMap["node"];
function text(node: HtmlNode): string {
  if ("value" in node) return node.value;
  return "childNodes" in node ? node.childNodes.map(text).join("") : "";
}
async function docx(bytes: Buffer): Promise<ParsedFile> {
  checkDocxZip(bytes);
  const converted = await mammoth.convertToHtml(
    { buffer: bytes },
    {
      externalFileAccess: false,
      includeEmbeddedStyleMap: false,
      convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
    },
  );
  const blocks: Extract<ParsedFile, { kind: "docx" }>["blocks"] = [];
  function visit(node: HtmlNode) {
    if (!("tagName" in node)) return;
    if (/^h[1-6]$/.test(node.tagName))
      blocks.push({
        kind: "heading",
        level: Number(node.tagName[1]),
        text: text(node),
      });
    else if (node.tagName === "p" || node.tagName === "li")
      blocks.push({
        kind: node.tagName === "li" ? "list-item" : "paragraph",
        text: text(node),
      });
    else if (node.tagName === "img")
      blocks.push({ kind: "image", text: "Image" });
    else if (node.tagName === "table") {
      const rows: string[][] = [];
      function rowWalk(n: HtmlNode) {
        if ("tagName" in n && n.tagName === "tr")
          rows.push(
            n.childNodes
              .filter((c) => "tagName" in c && ["td", "th"].includes(c.tagName))
              .map(text),
          );
        else if ("childNodes" in n) n.childNodes.forEach(rowWalk);
      }
      rowWalk(node);
      blocks.push({ kind: "table", rows });
    } else node.childNodes.forEach(visit);
  }
  parseFragment(converted.value).childNodes.forEach(visit);
  return {
    kind: "docx",
    blocks,
    text: blocks
      .map((b) =>
        b.kind === "table"
          ? b.rows.map((r) => r.join("\t")).join("\n")
          : b.text,
      )
      .join("\n"),
  };
}

export async function parseFile(input: Uint8Array): Promise<ParsedFile> {
  const bytes = Buffer.from(input);
  if (bytes.length < 4 || bytes.length > fileLimits.bytes)
    throw new Error("Choose a file between 4 bytes and 50 MB.");
  const kind = sniff(bytes);
  if (kind === "csv") return csv(bytes);
  if (kind === "docx") return docx(bytes);
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    const options = { isEvalSupported: false, useSystemFonts: false };
    pdf = await getDocumentProxy(new Uint8Array(bytes), options);
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException")
      throw new Error("This PDF is password protected.", { cause: error });
    throw new Error("This PDF could not be read.", { cause: error });
  }
  try {
    const result = await extractText(pdf, { mergePages: false });
    const outline: string[] = [];
    function walk(items: Awaited<ReturnType<typeof pdf.getOutline>>) {
      for (const item of items ?? []) {
        outline.push(item.title);
        walk(item.items);
      }
    }
    walk(await pdf.getOutline());
    return {
      kind: "pdf",
      pages: result.text,
      outline,
      text: result.text.join("\n"),
    };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
