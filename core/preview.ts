import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { command } from "./process.ts";
import { sourceFiles } from "./recipe.ts";
import { verifyProtected, hashes } from "./install.ts";
import { renderCandidate } from "./render/index.ts";
import { Preview, type Change } from "./state.ts";
import type { Options } from "./supervisor.ts";
import type { Surface } from "./render/schema.ts";

export async function sourceIdentity(stage: string) {
  const hash = createHash("sha256");
  for (const file of (await sourceFiles(stage)).sort()) hash.update(JSON.stringify([file, (await readFile(join(stage, file))).toString("base64")]));
  return hash.digest("hex");
}
export async function uiChanged(stage: string) {
  return (await command("git", ["diff", "--cached", "--name-only", "--no-ext-diff", "-z"], stage, 120000, true)).split("\0").some(path => path.startsWith("apps/web/"));
}
export async function stagedIdentity(stage: string) {
  await command("git", ["diff", "--exit-code", "--no-ext-diff"], stage);
  if (await command("git", ["ls-files", "--others", "--exclude-standard", "--", "apps", "packages", "core", "selfmod"], stage)) throw new Error("apps/web: a matching preview requires all source edits to be staged");
  return sourceIdentity(stage);
}
const Reports = z.array(z.object({ shots: z.array(z.object({ file: z.string().regex(/^[a-z0-9-]+\.png$/), width: z.number(), theme: z.enum(["light", "dark"]), changed: z.number().default(0) })) }));
export async function previewChange(options: Options, entry: Change, surfaces: Surface[]) {
  const { data, core, dependencies } = options, stage = join(data, "staging", entry.id), active = join(data, "releases", entry.base);
  await verifyProtected(stage, await hashes(active));
  const names = await readdir(join(stage, "apps/web/surfaces")).catch((error: unknown) => { if (error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error; });
  for (const name of names) if (!surfaces.some(surface => surface.name === name)) throw new Error(`apps/web/surfaces/${name}: declared render steps are required`);
  const hash = await stagedIdentity(stage), key = createHash("sha256").update(JSON.stringify([entry.base, surfaces])).digest("hex"), cache = join(data, "previews/before", key);
  const scenarios = ["empty", "answer", "proposal", "setups", "failed", ...surfaces.map(surface => surface.name)];
  await mkdir(join(data, "previews/before"), { recursive: true });
  try { await readFile(join(cache, "ready")); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    await rm(cache, { recursive: true, force: true });
    const existing: string[] = await readdir(join(active, "apps/web/surfaces")).catch(() => []);
    const baseline = join(data, "previews/baseline", entry.base);
    try { await readFile(join(baseline, "ready")); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      const rendered = await renderCandidate({ stage: active, core, dependencies });
      try {
        await mkdir(baseline, { recursive: true });
        for (const scenario of scenarios.slice(0, 5)) await cp(join(rendered.scratch, scenario), join(baseline, scenario), { recursive: true });
        await writeFile(join(baseline, "ready"), entry.base);
      } finally { await rm(rendered.scratch, { recursive: true, force: true }); }
    }
    const declared = surfaces.filter(surface => existing.includes(surface.name));
    const before = declared.length ? await renderCandidate({ stage: active, core, dependencies, surfaces: declared, baseline: false }) : undefined;
    try {
      for (const scenario of scenarios) {
        const from = existing.includes(scenario) || !surfaces.some(surface => surface.name === scenario) ? scenario : "empty";
        await mkdir(join(cache, scenario), { recursive: true });
        for (const width of [320, 1000]) for (const theme of ["light", "dark"]) for (const ext of ["png", "jpg"]) await cp(join(existing.includes(from) && before ? before.scratch : baseline, from, `${from}-${width}-${theme}.${ext}`), join(cache, scenario, `${scenario}-${width}-${theme}.${ext}`));
      }
      await writeFile(join(cache, "ready"), entry.base);
    } finally { if (before) await rm(before.scratch, { recursive: true, force: true }); }
  }
  const after = await renderCandidate({ stage, core, dependencies, surfaces, before: cache });
  try {
    if (hash !== await stagedIdentity(stage)) throw new Error("apps/web: source changed during preview. Preview again.");
    const shots = [], alsoChanged = [], destination = join(data, "previews/changes", entry.id);
    await mkdir(destination, { recursive: true });
    for (const [index, report] of Reports.parse(after.results).entries()) for (const shot of report.shots) {
      const scenario = scenarios[index], name = shot.file.replace(".png", ""), before = `before-${name}.jpg`, next = `after-${name}.jpg`;
      await cp(join(cache, scenario, `${name}.jpg`), join(destination, before));
      await cp(join(after.scratch, scenario, `${name}.jpg`), join(destination, next));
      if (index < 5 && shot.changed > 0.005) alsoChanged.push(name);
      shots.push({ name, scenario, width: shot.width, theme: shot.theme, before, after: next });
    }
    return Preview.parse({ hash, surfaces, shots, alsoChanged });
  } finally { await rm(after.scratch, { recursive: true, force: true }); }
}

export async function previewImages(data: string, entry: Change) {
  const images = [];
  for (const shot of entry.previews?.shots ?? []) for (const file of [shot.before, shot.after]) images.push({ name: file, data: (await readFile(join(data, "previews/changes", entry.id, file))).toString("base64"), mimeType: "image/jpeg" as const });
  return images;
}
