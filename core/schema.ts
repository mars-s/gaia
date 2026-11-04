import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { lstat, readdir } from "node:fs/promises";
import { z } from "zod";
export function schema(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return JSON.stringify({
      version: db.prepare("PRAGMA user_version").get(),
      definitions: db
        .prepare(
          "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name",
        )
        .all(),
    });
  } finally {
    db.close();
  }
}
export async function schemas(directory: string) {
  const result: Record<string, string> = {};
  async function inspect(path: string) {
    const file = await existing(join(directory, path));
    if (!file) return;
    if (file.isSymbolicLink())
      throw new Error("Symlink in managed database path.");
    if (!file.isFile())
      throw new Error("Managed database is not a regular file.");
    result[path] = schema(join(directory, path));
  }
  for (const name of ["gaia.sqlite", "pi.sqlite"]) {
    await inspect(name);
  }
  const profiles = join(directory, "experiences");
  const parent = await existing(profiles);
  if (!parent) return result;
  if (parent.isSymbolicLink())
    throw new Error("Symlink in profile storage path.");
  if (!parent.isDirectory())
    throw new Error("Profile storage is not a directory.");
  const entries = await readdir(profiles, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink())
      throw new Error("Symlink in profile storage path.");
    if (!entry.isDirectory()) continue;
    if (!z.string().uuid().safeParse(entry.name).success)
      throw new Error("Unexpected profile storage directory.");
    await inspect(join("experiences", entry.name, "pi.sqlite"));
  }
  return result;
}
export async function compatible(before: string, after: string) {
  const a = await schemas(before);
  const b = await schemas(after);
  const changed =
    ["gaia.sqlite", "pi.sqlite"].some((name) => a[name] !== b[name]) ||
    Object.entries(a).some(([path, definition]) => b[path] !== definition) ||
    Object.entries(b).some(
      ([path, definition]) =>
        path.startsWith("experiences/") &&
        definition !== (a[path] ?? a["pi.sqlite"]),
    );
  if (changed)
    throw new Error(
      "Schema version or definitions changed. Migrations are not supported.",
    );
}

async function existing(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}
