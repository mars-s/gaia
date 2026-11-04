import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { access } from "node:fs/promises";
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
  for (const name of ["gaia.sqlite", "pi.sqlite"]) {
    try {
      await access(join(directory, name));
    } catch {
      continue;
    }
    result[name] = schema(join(directory, name));
  }
  return result;
}
export async function compatible(before: string, after: string) {
  const a = await schemas(before);
  const b = await schemas(after);
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(
      "Schema version or definitions changed. Migrations are not supported.",
    );
}
