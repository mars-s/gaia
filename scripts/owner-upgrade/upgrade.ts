import {
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  symlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { hashes, verifyProtected } from "../../core/install.ts";
import { recipe } from "../../core/recipe.ts";
import { compatible } from "../../core/schema.ts";
import { State, readState } from "../../core/state.ts";
import {
  type Installer,
  manifests,
  provision,
  verifyDependency,
  verifyInstalled,
} from "./dependencies.ts";
import {
  dataRoot,
  digest,
  equal,
  fingerprint,
  Hashes,
  inventory,
  noLinks,
  readJson,
  sameHashes,
  stat,
  writeBytes,
  writeJson,
} from "./files.ts";
import { controls, gates, Journal, locations, Prepared } from "./model.ts";
import { assertStopped, withOwnerLock } from "./ownership.ts";
import {
  planDependencies,
  restoreJournal,
  switchDependencies,
} from "./recovery.ts";
import {
  coreDiff,
  coreSource,
  exportSource,
  installRelease,
  stageCore,
  verifyPrepared,
} from "./source.ts";

async function controlHashes(data: string) {
  const result: Hashes = {};
  for (const name of controls) {
    await noLinks(join(data, "control", name));
    result[name] = await fingerprint(join(data, "control", name));
  }
  return result;
}

export async function prepare({
  source,
  data: requestedData,
  allowedCore = [],
  installer,
  check = recipe,
  record = async () => {},
}: {
  source: string;
  data: string;
  allowedCore?: string[];
  installer?: Installer;
  check?: typeof recipe;
  record?: (result: string) => Promise<void>;
}) {
  const data = await dataRoot(requestedData);
  return withOwnerLock(data, false, async () => {
    const previousControls = await controlHashes(data);
    const previous = await readState(data);
    if (previous.kind !== "stable" || previous.failures !== 0)
      throw new Error(
        "Prepare an owner upgrade only from a healthy stable installation.",
      );
    const oldCore = z
      .string()
      .parse(await readJson(join(data, "control/core.json")));
    if (
      resolve(oldCore) !== oldCore ||
      !oldCore.startsWith(`${data}/protected/`)
    )
      throw new Error("Installed core must be inside DATA/protected.");
    await noLinks(oldCore);
    await verifyProtected(
      oldCore,
      Hashes.parse(await readJson(join(oldCore, "integrity.json"))),
    );
    const oldCoreFiles = await coreSource(oldCore);
    const id = randomUUID();
    const paths = locations(data, id);
    await mkdir(paths.directory, { recursive: true, mode: 0o700 });
    const exported = await exportSource(
      await realpath(resolve(source)),
      paths.stage,
      id,
    );
    const allowed = [...allowedCore].sort();
    const coreChanges = coreDiff(
      oldCoreFiles,
      await coreSource(paths.stage),
      allowed,
    );
    const currentRelease = join(data, "releases", previous.active.release);
    await noLinks(currentRelease);
    const dependency = await provision({
      data,
      before: currentRelease,
      stage: paths.stage,
      installer,
    });
    await symlink(dependency.path, join(paths.stage, "node_modules"));
    const coreFiles = await stageCore(paths.stage, paths.core, dependency.path);
    const protectedFiles = await hashes(paths.stage);
    const checks: string[] = [];
    await writeJson(join(paths.directory, "preparing.json"), {
      id,
      data,
      ...exported,
      previous,
      allowedCore: allowed,
      coreChanges,
      dependency,
    });
    await check({
      stage: paths.stage,
      core: paths.core,
      dependencies: dependency.path,
      release: exported.release,
      async record(result) {
        checks.push(result);
        await writeJson(join(paths.directory, "checks.json"), checks);
        await record(result);
      },
    });
    if (!equal(checks, gates))
      throw new Error("Trusted preparation checks are incomplete.");
    const p = Prepared.parse({
      version: 2,
      id,
      data,
      ...exported,
      previous,
      previousControls,
      oldCore,
      oldCoreFiles,
      protectedFiles,
      coreFiles,
      coreChanges,
      allowedCore: allowed,
      dependency,
      checks,
      buildFiles: await inventory(join(paths.stage, "dist")),
      phase: "prepared",
    });
    await verifyPrepared(p);
    await verifyDependency(dependency, paths.stage, data);
    await writeJson(paths.prepared, p);
    return {
      preparedFile: paths.prepared,
      sourceCommit: p.sourceCommit,
      release: p.release,
      coreChanges,
      dependency,
      checks,
      activated: false,
    };
  });
}

export async function readPrepared(file: string) {
  const p = Prepared.parse(await readJson(file));
  if (
    (await dataRoot(p.data)) !== p.data ||
    file !== locations(p.data, p.id).prepared
  )
    throw new Error(
      "Prepared paths are outside their owner-upgrade directory.",
    );
  if (
    resolve(p.oldCore) !== p.oldCore ||
    !p.oldCore.startsWith(`${p.data}/protected/`)
  )
    throw new Error("Prepared old core path is outside DATA/protected.");
  await noLinks(p.oldCore);
  return p;
}

export type ActivationStep =
  "after-dependencies" | "after-protected" | "after-manifest";
export async function activate(
  file: string,
  checkpoint: (step: ActivationStep) => Promise<void> = async () => {},
) {
  const p = await readPrepared(file);
  await assertStopped(p.data);
  return withOwnerLock(p.data, true, async () => {
    const paths = locations(p.data, p.id);
    if ((await stat(paths.journal)) || (await stat(paths.backup)))
      throw new Error(
        "An activation attempt already exists. Recover its journal or prepare afresh.",
      );
    const previous = await readState(p.data);
    if (
      !equal(previous, p.previous) ||
      !equal(await controlHashes(p.data), p.previousControls)
    )
      throw new Error(
        "Preparation is stale; prepare against the current stable controls.",
      );
    if (
      z.string().parse(await readJson(join(p.data, "control/core.json"))) !==
      p.oldCore
    )
      throw new Error("Preparation does not name the actual installed core.");
    await verifyPrepared(p);
    await manifests(
      join(p.data, "releases", p.previous.active.release),
      paths.stage,
    );
    await verifyInstalled(
      join(p.data, "releases", p.previous.active.release),
      paths.dependencies,
    );
    await verifyDependency(p.dependency, paths.stage, p.data);
    await noLinks(join(p.data, "repo/.git"));
    if (!(await lstat(join(p.data, "repo/.git"))).isDirectory())
      throw new Error("Managed repository must own .git.");
    await mkdir(paths.backup, { mode: 0o700 });
    for (const name of controls)
      await writeBytes(
        join(paths.backup, name),
        await readFile(join(p.data, "control", name)),
      );
    const pair = { release: p.release, generation: randomUUID(), schema: 1 };
    const oldGeneration = join(
      p.data,
      "generations",
      previous.active.generation,
    );
    const generation = join(p.data, "generations", pair.generation);
    const oldFiles = await inventory(oldGeneration);
    await cp(oldGeneration, generation, { recursive: true });
    sameHashes(
      await inventory(generation),
      oldFiles,
      "Offline generation copy changed",
    );
    await compatible(oldGeneration, generation);
    await installRelease(p, p.coreFiles);
    const next = State.parse({
      ...previous,
      kind: "stable",
      active: pair,
      good: pair,
      failures: 0,
    });
    const afterBytes = {
      "core.json": JSON.stringify(paths.newCore),
      "protected.json": JSON.stringify(p.protectedFiles),
      "manifest.json": JSON.stringify(next),
      "history.json": await readFile(
        join(paths.backup, "history.json"),
        "utf8",
      ),
    };
    const after = Object.fromEntries(
      controls.map((name) => [name, digest(afterBytes[name])]),
    );
    const dependency = await planDependencies(p.data, p.id, p.dependency.path);
    const journal = Journal.parse({
      version: 2,
      id: p.id,
      data: p.data,
      previous,
      next,
      before: p.previousControls,
      after,
      dependency,
    });
    // The journal and all four backups are durable before any live pointer changes.
    await writeJson(paths.journal, journal);
    try {
      await assertStopped(p.data, true);
      await switchDependencies(journal);
      await checkpoint("after-dependencies");
      await writeBytes(
        join(p.data, "control/protected.json"),
        afterBytes["protected.json"],
      );
      await checkpoint("after-protected");
      await writeBytes(
        join(p.data, "control/manifest.json"),
        afterBytes["manifest.json"],
      );
      await checkpoint("after-manifest");
      await writeBytes(
        join(p.data, "control/core.json"),
        afterBytes["core.json"],
      );
      await writeJson(join(paths.directory, "activated.json"), {
        phase: "awaiting-runtime-verification",
        runtimeVerified: false,
      });
    } catch (error) {
      try {
        await restoreJournal(journal);
      } catch (recoveryError) {
        throw new AggregateError(
          [error, recoveryError],
          `Activation failed and recovery refused. Keep Gaia stopped and inspect ${paths.journal}`,
          { cause: recoveryError },
        );
      }
      throw error;
    }
    return {
      journalFile: paths.journal,
      active: pair,
      newCore: paths.newCore,
      runtimeVerified: false,
    };
  });
}
