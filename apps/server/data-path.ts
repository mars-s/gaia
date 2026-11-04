import type { DatabaseSync } from "node:sqlite";
import { basename, dirname, isAbsolute } from "node:path";
import { z } from "zod";

export function generationDirectory(db: DatabaseSync) {
  const main = z.object({ name: z.literal("main"), file: z.string() }).parse(
    db
      .prepare("PRAGMA database_list")
      .all()
      .find((row) => row.name === "main"),
  );
  if (!isAbsolute(main.file) || basename(main.file) !== "gaia.sqlite")
    throw new Error("Generation storage requires a file-backed gaia.sqlite.");
  return dirname(main.file);
}
