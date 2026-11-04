import {
  lstat,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type DependencySwitch,
  type Identity,
  Journal,
  controls,
  locations,
} from "./model.ts";
import {
  dataRoot,
  digest,
  equal,
  noLinks,
  readJson,
  stat,
  syncDirectory,
  writeBytes,
  writeJson,
} from "./files.ts";
import { assertStopped, withOwnerLock } from "./ownership.ts";

export async function identity(path: string): Promise<Identity | null> {
  const info = await stat(path);
  if (!info) return null;
  const common = { dev: info.dev, ino: info.ino };
  if (info.isSymbolicLink())
    return { ...common, kind: "symlink", target: await readlink(path) };
  if (info.isDirectory()) return { ...common, kind: "directory" };
  throw new Error(`Expected a dependency directory or symlink: ${path}`);
}

export async function planDependencies(
  data: string,
  id: string,
  next: string,
): Promise<DependencySwitch> {
  const paths = locations(data, id);
  const original = await identity(paths.dependencies);
  if (!original) throw new Error("Current dependency tree is missing.");
  if (next === paths.dependencies) return { kind: "unchanged", original };
  if (
    (await stat(paths.originalDependencies)) ||
    (await stat(paths.temporaryDependencies))
  )
    throw new Error("Dependency backup or temporary pointer already exists.");
  await symlink(next, paths.temporaryDependencies);
  const replacement = await identity(paths.temporaryDependencies);
  if (!replacement)
    throw new Error("Replacement dependency pointer is missing.");
  await syncDirectory(dirname(paths.temporaryDependencies));
  return { kind: "switch", original, replacement };
}

export async function switchDependencies(journal: Journal) {
  const paths = locations(journal.data, journal.id);
  const plan = journal.dependency;
  if (!equal(await identity(paths.dependencies), plan.original))
    throw new Error("Original dependencies were replaced.");
  if (plan.kind === "unchanged") return;
  if (!equal(await identity(paths.temporaryDependencies), plan.replacement))
    throw new Error("Replacement dependencies were replaced.");
  await rename(paths.dependencies, paths.originalDependencies);
  await syncDirectory(dirname(paths.dependencies));
  await syncDirectory(paths.directory);
  await rename(paths.temporaryDependencies, paths.dependencies);
  await syncDirectory(dirname(paths.dependencies));
}

async function validateRestore(journal: Journal) {
  const paths = locations(journal.data, journal.id);
  for (const name of controls) {
    const backup = join(paths.backup, name);
    await noLinks(backup);
    if (digest(await readFile(backup)) !== journal.before[name])
      throw new Error(`Control backup changed: ${name}`);
    const current = join(journal.data, "control", name);
    await noLinks(current);
    const hash = digest(await readFile(current));
    if (hash !== journal.before[name] && hash !== journal.after[name])
      throw new Error(
        `Foreign control replacement or later release; refuse restore: ${name}`,
      );
  }
  const canonical = await identity(paths.dependencies);
  const plan = journal.dependency;
  if (plan.kind === "unchanged") {
    if (!equal(canonical, plan.original))
      throw new Error("Foreign dependency replacement; refuse restore.");
    return;
  }
  const backup = await identity(paths.originalDependencies);
  const temporary = await identity(paths.temporaryDependencies);
  if (
    (canonical &&
      !equal(canonical, plan.original) &&
      !equal(canonical, plan.replacement)) ||
    (backup && !equal(backup, plan.original)) ||
    (temporary && !equal(temporary, plan.replacement))
  )
    throw new Error("Foreign dependency replacement; refuse restore.");
  if (!equal(canonical, plan.original) && !equal(backup, plan.original))
    throw new Error("Original dependency backup is missing.");
  if (equal(canonical, plan.original) && backup)
    throw new Error("Ambiguous original dependency locations; refuse restore.");
}

export async function restoreJournal(journal: Journal) {
  await assertStopped(journal.data, true);
  await validateRestore(journal);
  const paths = locations(journal.data, journal.id);
  const plan = journal.dependency;
  if (plan.kind === "switch") {
    const current = await identity(paths.dependencies);
    if (equal(current, plan.replacement)) {
      if (await stat(paths.temporaryDependencies))
        throw new Error("Ambiguous replacement dependency locations.");
      await rename(paths.dependencies, paths.temporaryDependencies);
      await syncDirectory(dirname(paths.dependencies));
    }
    if (!(await stat(paths.dependencies))) {
      await rename(paths.originalDependencies, paths.dependencies);
      await syncDirectory(dirname(paths.dependencies));
      await syncDirectory(paths.directory);
    }
    if (await stat(paths.temporaryDependencies)) {
      await rm(paths.temporaryDependencies);
      await syncDirectory(dirname(paths.dependencies));
    }
  }
  for (const name of controls)
    await writeBytes(
      join(journal.data, "control", name),
      await readFile(join(paths.backup, name)),
    );
  await writeJson(join(paths.directory, "restored.json"), {
    restored: true,
    at: new Date().toISOString(),
  });
}

export async function readJournal(file: string) {
  const journal = Journal.parse(await readJson(file));
  if (
    (await dataRoot(journal.data)) !== journal.data ||
    file !== locations(journal.data, journal.id).journal
  )
    throw new Error("Journal paths are outside their owner-upgrade directory.");
  for (const name of controls) {
    if (!journal.before[name] || !journal.after[name])
      throw new Error("Journal control hashes are incomplete.");
  }
  const plan = journal.dependency;
  if (
    plan.kind === "switch" &&
    (plan.replacement.kind !== "symlink" ||
      !plan.replacement.target.startsWith(`${journal.data}/dependency-sets/`) ||
      !/^[a-f0-9]{64}\/node_modules$/.test(
        plan.replacement.target.slice(
          `${journal.data}/dependency-sets/`.length,
        ),
      ))
  )
    throw new Error("Journal dependency target is outside dependency-sets.");
  if (
    !(await lstat(locations(journal.data, journal.id).directory)).isDirectory()
  )
    throw new Error("Invalid journal directory.");
  return journal;
}

export async function restore(file: string) {
  const journal = await readJournal(file);
  return withOwnerLock(journal.data, true, async () => {
    await restoreJournal(journal);
    return {
      restored: true,
      active: journal.previous.active,
      runtimeVerified: false,
    };
  });
}
