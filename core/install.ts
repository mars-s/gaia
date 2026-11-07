import {
  mkdir,
  cp,
  symlink,
  readFile,
  writeFile,
  realpath,
  lstat,
} from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { atomic, type Pair } from "./state.ts";
import { command } from "./process.ts";
import { sourceFiles, recipe } from "./recipe.ts";
export function importable(path: string) {
  const name = path.split("/").at(-1) ?? "";
  return (
    !name.startsWith(".") &&
    !["node_modules", ".git", ".claude", "data", "dist"].includes(name) &&
    !/^(\.env(?:\..*)?|credentials(?:\..*)?|auth\.json|id_rsa|id_ed25519)$/i.test(
      name,
    ) &&
    !/\.(pem|key|p12|pfx|sqlite(?:-wal|-shm)?)$/i.test(name)
  );
}
export const editable = (path: string) =>
  /^(apps\/(web|server)\/|packages\/sdk\/)/.test(path) &&
  !/(^|\/)(auth\.ts|main\.ts|package(?:-lock)?\.json|.*\.config\..*|.*\.test\.tsx?)$/.test(
    path,
  );
export function validPath(path: string) {
  if (
    path.includes("\\") ||
    path.includes("\0") ||
    path.startsWith("/") ||
    path
      .split("/")
      .some(
        (part) =>
          !part || part === "." || part === ".." || part.startsWith("."),
      ) ||
    !editable(path)
  )
    throw new Error(`Protected or invalid path: ${path}`);
  return path;
}
export async function safeFile(root: string, path: string) {
  validPath(path);
  let cursor = root;
  for (const part of path.split("/")) {
    cursor = join(cursor, part);
    try {
      if ((await lstat(cursor)).isSymbolicLink())
        throw new Error("Symlinks are forbidden");
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
  }
  return cursor;
}
export async function hashes(root: string) {
  const result: Record<string, string> = {};
  for (const path of await sourceFiles(root)) {
    if (editable(path)) continue;
    result[path] = createHash("sha256")
      .update(await readFile(join(root, path)))
      .digest("hex");
  }
  return result;
}
export async function verifyProtected(
  root: string,
  expected: Record<string, string>,
) {
  const current = await hashes(root);
  for (const [path, hash] of Object.entries(expected))
    if (current[path] !== hash)
      throw new Error(`Protected file changed: ${path}`);
  for (const path of Object.keys(current))
    if (!(path in expected))
      throw new Error(`Unexpected protected file: ${path}`);
}
export async function importBaseline(
  source: string,
  data: string,
  core: string,
  dependencies: string,
) {
  const repo = join(data, "repo");
  await mkdir(repo, { recursive: true });
  const git = await lstat(join(repo, ".git")).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  });
  if (git && (!git.isDirectory() || git.isSymbolicLink()))
    throw new Error("The managed repository must own its .git directory.");
  let imported = false;
  if (git)
    try {
      await command(
        "git",
        ["--git-dir", join(repo, ".git"), "rev-parse", "--verify", "HEAD"],
        repo,
      );
      imported = true;
    } catch {
      /* An interrupted import has no baseline commit yet. */
    }
  if (!imported) {
    for (const name of [
      "apps/server",
      "apps/web",
      "packages",
      "core",
      "selfmod",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "eslint.config.js",
      "vite.config.ts",
      "LICENSE",
    ]) {
      await cp(join(source, name), join(repo, name), {
        recursive: true,
        filter: importable,
      });
    }
    await command("git", ["init", "-q"], repo);
    await command("git", ["config", "user.email", "gaia@localhost"], repo);
    await command("git", ["config", "user.name", "Gaia local changes"], repo);
    await command("git", ["add", "."], repo);
    await command("git", ["commit", "-qm", "Import local Gaia baseline"], repo);
  }
  await atomic(join(data, "control/protected.json"), await hashes(repo));
  if (!imported) await symlink(dependencies, join(repo, "node_modules"));
  const commit = await command("git", ["rev-parse", "HEAD"], repo);
  const releaseDir = join(data, "releases", commit);
  try {
    await lstat(releaseDir);
  } catch {
    await command(
      "git",
      ["worktree", "add", "--detach", releaseDir, commit],
      repo,
    );
    await symlink(dependencies, join(releaseDir, "node_modules"));
  }
  await recipe({
    data,
    stage: releaseDir,
    core,
    dependencies,
    release: commit,
    record: async (result) => {
      process.stdout.write(`Baseline ${result}\n`);
    },
  });
  const pair: Pair = { release: commit, generation: randomUUID(), schema: 1 };
  const generation = join(data, "generations", pair.generation);
  await mkdir(generation, { recursive: true });
  // The first import may include the seed database. Later starts never reimport it.
  const legacyPath = join(data, "gaia.sqlite");
  try {
    const old = new DatabaseSync(legacyPath, { readOnly: true });
    try {
      const credentials = new DatabaseSync(
        join(data, "credentials/oauth.sqlite"),
      );
      credentials.exec(
        "CREATE TABLE IF NOT EXISTS credentials (provider TEXT PRIMARY KEY, value TEXT NOT NULL)",
      );
      const table = old
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='credentials'",
        )
        .get();
      if (table)
        for (const row of old
          .prepare("SELECT provider,value FROM credentials")
          .all())
          credentials
            .prepare("INSERT OR IGNORE INTO credentials VALUES (?,?)")
            .run(row.provider, row.value);
      credentials.close();
      old.exec(
        `VACUUM INTO '${join(generation, "gaia.sqlite").replaceAll("'", "''")}'`,
      );
      const copy = new DatabaseSync(join(generation, "gaia.sqlite"));
      copy.exec("DROP TABLE IF EXISTS credentials");
      copy.close();
    } finally {
      old.close();
    }
  } catch (error) {
    if (!(
      error instanceof Error &&
      error.message.includes("unable to open database")
    ))
      throw error;
  }
  try {
    const oldPi = new DatabaseSync(join(data, "pi.sqlite"), { readOnly: true });
    try {
      oldPi.exec(
        `VACUUM INTO '${join(generation, "pi.sqlite").replaceAll("'", "''")}'`,
      );
    } finally {
      oldPi.close();
    }
  } catch (error) {
    if (!(
      error instanceof Error &&
      error.message.includes("unable to open database")
    ))
      throw error;
  }
  await atomic(join(data, "control/manifest.json"), {
    kind: "stable",
    active: pair,
    good: pair,
    failures: 0,
  });
  await atomic(join(data, "control/history.json"), []);
}
export async function installCore(
  source: string,
  destination: string,
  dependencies: string,
) {
  const sourceCore = await realpath(join(source, "core"));
  const target = resolve(destination);
  if (
    relative(sourceCore, target) === "" ||
    target.startsWith(sourceCore + "/")
  )
    throw new Error("Core installation must be separate");
  await mkdir(target, { recursive: true, mode: 0o700 });
  for (const name of [
    "core",
    "packages/protocol",
    "tsconfig.json",
    "eslint.config.js",
    "package.json",
  ])
    await cp(join(source, name), join(target, name), { recursive: true });
  await symlink(dependencies, join(target, "node_modules"));
  await writeFile(
    join(target, "integrity.json"),
    JSON.stringify(await hashes(target)),
  );
}
