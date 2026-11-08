import { z } from "zod";

export const fileLimits = {
  bytes: 50 * 1024 * 1024,
  count: 20,
  rows: 1_000_000,
  columns: 256,
  expandedBytes: 100 * 1024 * 1024,
  workerHeapMb: 256,
  timeoutMs: 20_000,
} as const;
export const FileSha = z.string().regex(/^[a-f0-9]{64}$/);
export const FileRef = z.strictObject({
  sha: FileSha,
  name: z.string().min(1).max(120),
});
export type FileRef = z.infer<typeof FileRef>;
export const FileUpload = z.strictObject({
  name: FileRef.shape.name,
  data: z
    .string()
    .min(4)
    .max(Math.ceil(fileLimits.bytes / 3) * 4)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});
export const Cell = z.union([z.string(), z.number().finite(), z.null()]);
export type Cell = z.infer<typeof Cell>;
export const DocumentBlock = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("heading"),
    level: z.number().int().min(1).max(6),
    text: z.string(),
  }),
  z.strictObject({
    kind: z.enum(["paragraph", "list-item", "image"]),
    text: z.string(),
  }),
  z.strictObject({
    kind: z.literal("table"),
    rows: z.array(z.array(z.string())),
  }),
]);
export const ParsedFile = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("csv"),
    columns: z
      .array(
        z.strictObject({
          name: z.string(),
          type: z.enum(["number", "date", "text", "category"]),
        }),
      )
      .max(fileLimits.columns),
    rows: z.array(z.array(Cell)).max(fileLimits.rows),
  }),
  z.strictObject({
    kind: z.literal("docx"),
    blocks: z.array(DocumentBlock),
    text: z.string(),
  }),
  z.strictObject({
    kind: z.literal("pdf"),
    pages: z.array(z.string()),
    outline: z.array(z.string()),
    text: z.string(),
  }),
]);
export type ParsedFile = z.infer<typeof ParsedFile>;
export const FileCard = z.strictObject({
  file: FileRef,
  kind: z.enum(["csv", "docx", "pdf"]),
  fact: z.string(),
  preview: z.array(z.string()).max(6),
});

export type FileCard = z.infer<typeof FileCard>;
