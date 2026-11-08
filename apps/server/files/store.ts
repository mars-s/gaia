import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  FileUpload,
  FileSha,
  FileCard,
  ParsedFile,
  fileLimits,
} from "../../../packages/protocol/files.ts";
import { parseInWorker } from "./worker.ts";

export function openFiles(dataDirectory: string) {
  const directory = join(dataDirectory, "files");
  const pending = new Map<string, Promise<FileCard>>();
  async function read(sha: string) {
    const path = join(directory, FileSha.parse(sha));
    return {
      card: FileCard.parse(
        JSON.parse(await readFile(join(path, "card.json"), "utf8")),
      ),
      parsed: ParsedFile.parse(
        JSON.parse(await readFile(join(path, "parsed.json"), "utf8")),
      ),
    };
  }
  async function put(input: unknown) {
    const upload = FileUpload.parse(input);
    const bytes = Buffer.from(upload.data, "base64");
    if (
      bytes.length > fileLimits.bytes ||
      bytes.toString("base64") !== upload.data
    )
      throw new Error("Choose a file up to 50 MB.");
    const sha = createHash("sha256").update(bytes).digest("hex");
    const name =
      upload.name
        .normalize("NFKC")
        .replace(/[\\/\p{Cc}\p{Cf}]/gu, "_")
        .slice(0, 120)
        .trim() || "File";
    const file = { sha, name };
    try {
      const stored = await read(sha);
      return { ...stored.card, file };
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    const active = pending.get(sha);
    if (active) return { ...(await active), file };
    if (pending.size >= 2)
      throw new Error("Two files are being parsed. Try again shortly.");
    const task = (async () => {
      const parsed = await parseInWorker(bytes);
      const fact =
        parsed.kind === "csv"
          ? `CSV, ${parsed.rows.length.toLocaleString("en-AU")} rows, ${parsed.columns.length} columns`
          : parsed.kind === "pdf"
            ? `PDF, ${parsed.pages.length} pages`
            : `DOCX, ${parsed.blocks.length} blocks`;
      const preview =
        parsed.kind === "csv"
          ? [
              parsed.columns.map((c) => c.name).join(" · "),
              ...parsed.rows.slice(0, 5).map((r) => r.join(" · ")),
            ]
          : parsed.text.split("\n").slice(0, 6);
      const card = FileCard.parse({ file, kind: parsed.kind, fact, preview });
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temp = join(directory, `.pending-${randomUUID()}`);
      await mkdir(temp, { mode: 0o700 });
      try {
        await writeFile(join(temp, "original"), bytes, { mode: 0o600 });
        await writeFile(join(temp, "parsed.json"), JSON.stringify(parsed), {
          mode: 0o600,
        });
        await writeFile(join(temp, "card.json"), JSON.stringify(card), {
          mode: 0o600,
        });
        try {
          await rename(temp, join(directory, sha));
        } catch (error) {
          if (!(
            error instanceof Error &&
            "code" in error &&
            ["EEXIST", "ENOTEMPTY"].includes(String(error.code))
          ))
            throw error;
        }
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
      return card;
    })();
    pending.set(sha, task);
    try {
      return await task;
    } finally {
      pending.delete(sha);
    }
  }
  return { read, put };
}
