import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  installCore,
  hashes,
  importable,
  verifyProtected,
} from "../../core/install.ts";
import { command } from "../../core/process.ts";
import { type CoreChange, gates, locations, type Prepared } from "./model.ts";
import {
  equal,
  Hashes,
  inventory,
  noLinks,
  readJson,
  relativeFile,
  sameHashes,
} from "./files.ts";

const roots = ["apps", "packages", "core", "selfmod", "scripts/owner-upgrade"];
const rootFiles = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "eslint.config.js",
  "vite.config.ts",
  "LICENSE",
];
const generated = new Set([
  ".git",
  "node_modules",
  ".scratch",
  ".trusted-tsconfig.json",
  ".sandbox-proof.mjs",
  ".probe-data",
  "dist",
]);
export const coreGenerated = new Set([
  "node_modules",
  "integrity.json",
  ".sandbox-profiles",
  ".scratch",
]);

export const git = (cwd: string, args: string[], raw = false) =>
  command(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
    cwd,
    120000,
    raw,
  );

export async function exportSource(source: string, stage: string, id: string) {
  const sourceCommit = await git(source, ["rev-parse", "HEAD"]);
  const entries = (
    await git(source, ["ls-tree", "-rz", "--full-tree", "HEAD"], true)
  )
    .split("\0")
    .filter(Boolean);
  const paths: string[] = [];
  for (const entry of entries) {
    const tab = entry.indexOf("\t");
    const path = entry.slice(tab + 1);
    if (
      !rootFiles.includes(path) &&
      !roots.some((root) => path.startsWith(`${root}/`))
    )
      continue;
    relativeFile(path);
    if (!entry.startsWith("100644 ") && !entry.startsWith("100755 "))
      throw new Error(`Non-file Git entry refused: ${path}`);
    if (path.split("/").some((part) => !importable(part)))
      throw new Error(`Private or generated runtime source refused: ${path}`);
    paths.push(path);
  }
  for (const name of rootFiles)
    if (!paths.includes(name))
      throw new Error(`Missing committed runtime source: ${name}`);
  await mkdir(stage, { mode: 0o700 });
  const archive = join(dirname(stage), "source.tar");
  await git(source, [
    "archive",
    "--format=tar",
    `--output=${archive}`,
    sourceCommit,
    "--",
    ...paths,
  ]);
  try {
    await command("tar", ["-xf", archive, "-C", stage], dirname(stage));
  } finally {
    await rm(archive, { force: true });
  }
  const sourceFiles = await inventory(stage);
  if (!equal(Object.keys(sourceFiles).sort(), [...paths].sort()))
    throw new Error("Git archive changed the committed runtime file set.");
  // Archive attributes can transform bytes. Check every exported blob against HEAD.
  for (const path of paths) {
    const bytes = await readFile(join(stage, path));
    const actual = createHash("sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex");
    const expected = entries
      .find((entry) => entry.endsWith(`\t${path}`))
      ?.split(" ")[2]
      ?.split("\t")[0];
    if (actual !== expected)
      throw new Error(`Git archive changed committed bytes: ${path}`);
  }
  await git(stage, ["init", "-q"]);
  await git(stage, ["config", "user.name", "Gaia owner upgrade"]);
  await git(stage, ["config", "user.email", "gaia@localhost"]);
  await git(stage, ["add", "--", ...paths]);
  await git(stage, [
    "commit",
    "-qm",
    `Owner source ${sourceCommit}, preparation ${id}`,
  ]);
  return {
    sourceCommit,
    release: await git(stage, ["rev-parse", "HEAD"]),
    sourceFiles,
  };
}

export function coreDiff(
  before: Hashes,
  after: Hashes,
  allowed: string[],
): CoreChange[] {
  for (const path of allowed) {
    relativeFile(path);
    if (!path.startsWith("core/"))
      throw new Error(`Allowlist requires an exact core file: ${path}`);
  }
  if (new Set(allowed).size !== allowed.length)
    throw new Error("Duplicate core allowlist path.");
  const changes: CoreChange[] = [];
  for (const path of [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].sort()) {
    if (before[path] === after[path]) continue;
    if (!after[path]) throw new Error(`Core removal refused: ${path}`);
    if (!allowed.includes(path))
      throw new Error(`Unapproved core change: ${path}`);
    changes.push({
      path,
      beforeHash: before[path] ?? null,
      afterHash: after[path],
    });
  }
  if (
    !equal(
      changes.map((change) => change.path),
      [...allowed].sort(),
    )
  )
    throw new Error(
      "Core allowlist must exactly match the changed core files.",
    );
  return changes;
}

export async function coreSource(root: string) {
  return Object.fromEntries(
    Object.entries(await inventory(join(root, "core"))).map(([path, hash]) => [
      `core/${path}`,
      hash,
    ]),
  );
}

export async function stageCore(
  stage: string,
  core: string,
  dependencies: string,
) {
  await installCore(stage, core, dependencies);
  return inventory(core, coreGenerated);
}

export async function verifyPrepared(p: Prepared) {
  const paths = locations(p.data, p.id);
  if (!equal(p.checks, gates))
    throw new Error("Trusted preparation checks are incomplete.");
  await noLinks(paths.stage);
  if (!(await lstat(join(paths.stage, ".git"))).isDirectory())
    throw new Error("Prepared repository must own .git.");
  await noLinks(join(paths.stage, ".git"));
  if ((await git(paths.stage, ["rev-parse", "HEAD"])) !== p.release)
    throw new Error("Prepared source identity changed.");
  await git(paths.stage, ["diff", "HEAD", "--quiet"]);
  sameHashes(
    await inventory(paths.stage, generated),
    p.sourceFiles,
    "Prepared source changed",
  );
  await verifyProtected(paths.stage, p.protectedFiles);
  sameHashes(
    await inventory(join(paths.stage, "dist")),
    p.buildFiles,
    "Prepared build changed",
  );
  sameHashes(
    await inventory(paths.core, coreGenerated),
    p.coreFiles,
    "Prepared core changed",
  );
  sameHashes(
    await hashes(paths.core),
    p.coreFiles,
    "Prepared core inventory changed",
  );
  sameHashes(
    await hashes(paths.core),
    Hashes.parse(await readJson(join(paths.core, "integrity.json"))),
    "Core integrity record changed",
  );
  sameHashes(
    await coreSource(p.oldCore),
    p.oldCoreFiles,
    "Installed old core changed",
  );
  const next = await coreSource(paths.core);
  sameHashes(
    next,
    await coreSource(paths.stage),
    "Staged core differs from reviewed source",
  );
  if (!equal(coreDiff(p.oldCoreFiles, next, p.allowedCore), p.coreChanges))
    throw new Error(
      "Recorded core change hashes differ from actual old/new files.",
    );
  for (const root of [paths.stage, paths.core]) {
    if ((await readlink(join(root, "node_modules"))) !== p.dependency.path)
      throw new Error("Staged dependency link changed.");
  }
}

export async function installRelease(p: Prepared, coreFiles: Hashes) {
  const paths = locations(p.data, p.id);
  const repo = join(p.data, "repo");
  await noLinks(join(repo, ".git"));
  if (!(await lstat(join(repo, ".git"))).isDirectory())
    throw new Error("Managed repository must own .git.");
  await git(repo, ["fetch", "--no-tags", paths.stage, p.release]);
  const releaseDir = join(p.data, "releases", p.release);
  await git(repo, ["worktree", "add", "--detach", releaseDir, p.release]);
  await symlink(paths.dependencies, join(releaseDir, "node_modules"));
  await cp(join(paths.stage, "dist"), join(releaseDir, "dist"), {
    recursive: true,
  });
  sameHashes(
    await inventory(join(releaseDir, "dist")),
    p.buildFiles,
    "Copied build changed",
  );
  sameHashes(
    await inventory(releaseDir, generated),
    p.sourceFiles,
    "Copied source changed",
  );
  await verifyProtected(releaseDir, p.protectedFiles);
  await mkdir(paths.newCore, { mode: 0o700 });
  for (const path of Object.keys(coreFiles)) {
    await mkdir(dirname(join(paths.newCore, path)), {
      recursive: true,
      mode: 0o700,
    });
    await cp(join(paths.core, path), join(paths.newCore, path));
  }
  await cp(
    join(paths.core, "integrity.json"),
    join(paths.newCore, "integrity.json"),
  );
  await symlink(paths.dependencies, join(paths.newCore, "node_modules"));
  sameHashes(
    await inventory(paths.newCore, coreGenerated),
    coreFiles,
    "Copied core changed",
  );
}
