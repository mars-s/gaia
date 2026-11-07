import { readdir, readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
const target = { role: z.enum(["button", "textbox", "option", "link", "tab", "checkbox", "menuitem", "heading", "combobox"]), name: z.string().min(1).max(160) };
export const Surface = z.object({ name: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), steps: z.array(z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), ...target }).strict(),
  z.object({ kind: z.literal("type"), ...target, text: z.string().max(1000) }).strict(),
  z.object({ kind: z.literal("wait"), ...target }).strict(),
  z.object({ kind: z.literal("press"), key: z.enum(["Escape", "Enter", "Tab", "Space", "ArrowDown", "ArrowUp"]) }).strict(),
])).max(8) }).strict();
export const Surfaces = z.array(Surface).refine(items => new Set(items.map(item => item.name)).size === items.length, "Surface names must be unique").refine(items => items.every(item => !["empty", "answer", "proposal", "setups", "failed"].includes(item.name)), "Surface names must not replace baseline screens");
export type Surface = z.infer<typeof Surface>;


export async function readSurfaces(root: string): Promise<Surface[]> {
  const folder = join(root, "apps/web/surfaces");
  const entries = await readdir(folder, { withFileTypes: true }).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });
  const surfaces: Surface[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) throw new Error("Surface must be a directory");
    const path = join(folder, entry.name, "render.json");
    if ((await lstat(path)).isSymbolicLink()) throw new Error("Surface declaration symlink refused");
    const surface = Surface.parse(JSON.parse(await readFile(path, "utf8")));
    if (surface.name !== entry.name) throw new Error("Surface name must match its directory");
    surfaces.push(surface);
  }
  return Surfaces.parse(surfaces);
}
