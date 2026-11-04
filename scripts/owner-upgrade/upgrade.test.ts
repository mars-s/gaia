import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { hashes } from "../../core/install.ts";
import { schemas } from "../../core/schema.ts";
import { atomic, readState } from "../../core/state.ts";
import {
  type ActivationStep,
  activate,
  prepare,
  readPrepared,
} from "./upgrade.ts";
import { controls, locations } from "./model.ts";
import {
  digest,
  Hashes,
  inventory,
  readJson,
  stat,
  writeJson,
} from "./files.ts";
import {
  identity,
  readJournal,
  restore,
  switchDependencies,
} from "./recovery.ts";
import { coreDiff, exportSource, git } from "./source.ts";
import { manifests, provision, verifyInstalled } from "./dependencies.ts";
import {
  changeSource,
  fakeInputs,
  fakeInstaller,
  fixture,
  fixtureChecks,
} from "./testing.ts";

const prepareFixture = (
  f: Awaited<ReturnType<typeof fixture>>,
  allowedCore: string[] = [],
) =>
  prepare({
    ...f,
    allowedCore,
    installer: fakeInstaller,
    check: fixtureChecks,
  });
const controlBytes = async (data: string) =>
  Promise.all(controls.map((name) => readFile(join(data, "control", name))));

test("explicit failed-start restore accepts only watchdog changes on the same upgraded pair", async () => {
  for (const mode of ["stable", "safe"] as const) {
    const f = await fixture();
    try {
      const before = await controlBytes(f.data);
      const original = await identity(
        join(f.data, "dependencies/node_modules"),
      );
      await changeSource(f.source);
      const prepared = await prepareFixture(f);
      const activated = await activate(prepared.preparedFile);
      const state = await readState(f.data);
      const failed =
        mode === "safe"
          ? {
              ...state,
              kind: "safe",
              failures: 3,
              reason: "Three synthetic startup failures.",
            }
          : { ...state, kind: "stable", failures: 1 };
      await atomic(join(f.data, "control/manifest.json"), failed);
      await assert.rejects(
        restore(activated.journalFile),
        /Foreign control replacement or later release/,
      );
      await restore(activated.journalFile, { failedStart: true });
      await restore(activated.journalFile, { failedStart: true });
      assert.deepEqual(await controlBytes(f.data), before);
      assert.deepEqual(
        await identity(join(f.data, "dependencies/node_modules")),
        original,
      );
      assert.deepEqual(
        await readFile(join(f.data, "credentials/oauth.sqlite")),
        f.beforeCredential,
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

test("failed-start restore still refuses foreign pairs, receipts and pending self-change", async () => {
  const f = await fixture();
  try {
    await changeSource(f.source);
    const prepared = await prepareFixture(f);
    const activated = await activate(prepared.preparedFile);
    const state = await readState(f.data);
    const manifest = join(f.data, "control/manifest.json");
    for (const foreign of [
      {
        ...state,
        failures: 1,
        active: { ...state.active, release: "e".repeat(40) },
      },
      {
        ...state,
        failures: 1,
        good: {
          ...state.good,
          generation: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        },
      },
      {
        ...state,
        failures: 1,
        receipt: {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          outcome: "accepted",
          detail: "Different change",
          commit: null,
        },
      },
      {
        ...state,
        failures: 1,
        kind: "checking",
        change: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      },
      { ...state, failures: 1, unexpected: "foreign control field" },
    ]) {
      await atomic(manifest, foreign);
      await assert.rejects(
        restore(activated.journalFile, { failedStart: true }),
        /Foreign control replacement or later release/,
      );
    }
    await atomic(manifest, state);
    await restore(activated.journalFile);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("archive exports committed runtime bytes only, owns Git, rejects source symlinks", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.source, ".claude"));
    await writeFile(join(f.source, ".claude/private"), "fake excluded marker");
    await mkdir(join(f.source, "data"));
    await writeFile(join(f.source, "data/private"), "fake excluded marker");
    await writeFile(
      join(f.source, "core/child.ts"),
      "uncommitted work stays outside",
    );
    await writeFile(
      join(f.source, "apps/server/untracked.ts"),
      "untracked marker",
    );
    const stage = join(f.root, "exported");
    const exported = await exportSource(f.source, stage, "fixture-id");
    assert.equal(
      exported.sourceCommit,
      await git(f.source, ["rev-parse", "HEAD"]),
    );
    assert.equal(
      await readFile(join(stage, "core/child.ts"), "utf8"),
      "export const baseline = true;\n",
    );
    assert.equal(await stat(join(stage, ".claude")), null);
    assert.equal(await stat(join(stage, "data")), null);
    assert.equal(await stat(join(stage, "apps/server/untracked.ts")), null);
    assert.equal(await git(stage, ["config", "user.email"]), "gaia@localhost");
    await symlink("auth.ts", join(f.source, "core/link.ts"));
    await git(f.source, ["add", "core/link.ts"]);
    await git(f.source, ["commit", "-qm", "Synthetic forbidden link"]);
    await assert.rejects(
      exportSource(f.source, join(f.root, "refused"), "refuse"),
      /Non-file Git entry refused/,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("explicit core allowlist describes exactly changed union, additions use null, removals fail", async () => {
  const h = digest("before");
  const next = digest("after");
  assert.deepEqual(
    coreDiff(
      { "core/child.ts": h },
      { "core/child.ts": next, "core/child.test.ts": next },
      ["core/child.ts", "core/child.test.ts"],
    ),
    [
      { path: "core/child.test.ts", beforeHash: null, afterHash: next },
      { path: "core/child.ts", beforeHash: h, afterHash: next },
    ],
  );
  assert.throws(
    () => coreDiff({ "core/child.ts": h }, { "core/child.ts": next }, []),
    /Unapproved core change/,
  );
  assert.throws(() => coreDiff({}, {}, ["core/child.ts"]), /exactly match/);
  assert.throws(
    () => coreDiff({ "core/child.ts": h }, {}, ["core/child.ts"]),
    /Core removal/,
  );
  assert.throws(
    () => coreDiff({}, {}, ["core/../auth.ts"]),
    /Invalid relative/,
  );
});

test("preparation refuses unapproved core, accepts the exact owner-reviewed changed paths", async () => {
  const f = await fixture();
  try {
    const allowed = [
      "core/child.ts",
      "core/child.test.ts",
      "core/testing/helper.ts",
    ];
    await changeSource(f.source, allowed);
    await assert.rejects(prepareFixture(f), /Unapproved core change/);
    const result = await prepareFixture(f, allowed);
    const p = await readPrepared(result.preparedFile);
    assert.deepEqual(p.allowedCore, [...allowed].sort());
    assert.equal(
      p.coreChanges.find((c) => c.path === "core/child.test.ts")?.beforeHash,
      null,
    );
    const activated = await activate(result.preparedFile);
    assert.equal(
      await readFile(join(activated.newCore, "core/child.ts"), "utf8"),
      "export const ownerReviewed = true;\n",
    );
    assert.equal(activated.runtimeVerified, false);
    await restore(activated.journalFile);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

for (const kind of ["directory", "symlink"] as const) {
  test(`dependency switch and idempotent restore preserve ${kind}, exact SQLite data and credentials`, async () => {
    const f = await fixture(kind);
    try {
      const before = await controlBytes(f.data);
      const originalDependencies = await identity(
        join(f.data, "dependencies/node_modules"),
      );
      const oldFiles = await inventory(f.generationDirectory);
      const oldSchemas = await schemas(f.generationDirectory);
      await changeSource(f.source);
      const prepared = await prepareFixture(f);
      const result = await activate(prepared.preparedFile);
      assert.equal(result.runtimeVerified, false);
      const p = await readPrepared(prepared.preparedFile);
      assert.equal(
        await readlink(join(f.data, "dependencies/node_modules")),
        p.dependency.path,
      );
      const generation = join(f.data, "generations", result.active.generation);
      assert.deepEqual(await inventory(generation), oldFiles);
      assert.deepEqual(await schemas(generation), oldSchemas);
      const db = new DatabaseSync(join(generation, "gaia.sqlite"), {
        readOnly: true,
      });
      assert.deepEqual(
        db
          .prepare("SELECT * FROM messages ORDER BY id")
          .all()
          .map((r) => ({ ...r })),
        [
          { id: 1, text: "Synthetic history retained" },
          { id: 2, text: "Exact reply 🌱" },
        ],
      );
      assert.equal(
        db.prepare("SELECT kind FROM profile").get()?.kind,
        "skipped",
      );
      db.close();
      assert.deepEqual(
        await readFile(join(f.data, "credentials/oauth.sqlite")),
        f.beforeCredential,
      );
      const credentials = new DatabaseSync(
        join(f.data, "credentials/oauth.sqlite"),
        { readOnly: true },
      );
      assert.equal(
        credentials
          .prepare(
            "SELECT value FROM credentials WHERE provider='fixture-marker'",
          )
          .get()?.value,
        "synthetic-only",
      );
      credentials.close();
      assert.deepEqual(await inventory(f.generationDirectory), oldFiles);
      await restore(result.journalFile);
      await restore(result.journalFile);
      assert.deepEqual(await controlBytes(f.data), before);
      assert.deepEqual(
        await identity(join(f.data, "dependencies/node_modules")),
        originalDependencies,
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
  for (const step of ["after-dependencies", "after-manifest"] as const) {
    test(`failure ${step} restores exact controls and original ${kind}`, async () => {
      const f = await fixture(kind);
      try {
        await changeSource(f.source);
        const p = await prepareFixture(f);
        const before = await controlBytes(f.data);
        const original = await identity(
          join(f.data, "dependencies/node_modules"),
        );
        await assert.rejects(
          activate(p.preparedFile, async (actual: ActivationStep) => {
            if (actual === step) throw new Error(`injected ${step}`);
          }),
          new RegExp(`injected ${step}`),
        );
        assert.deepEqual(await controlBytes(f.data), before);
        assert.deepEqual(
          await identity(join(f.data, "dependencies/node_modules")),
          original,
        );
        await restore(
          locations(f.data, (await readPrepared(p.preparedFile)).id).journal,
        );
      } finally {
        await rm(f.root, { recursive: true, force: true });
      }
    });
  }
}

test("active locks, live managed child, stale controls, build and core tampering all refuse", async () => {
  const f = await fixture();
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const result = await prepareFixture(f);
    const p = await readPrepared(result.preparedFile);
    const paths = locations(p.data, p.id);
    for (const lock of ["bootstrap.lock", "supervisor.lock"]) {
      await writeFile(join(f.data, "control", lock), String(process.pid));
      await assert.rejects(
        activate(result.preparedFile),
        /Stop the managed owner/,
      );
      await rm(join(f.data, "control", lock));
    }
    const alias = join(f.root, "data-alias");
    await symlink(f.data, alias);
    for (const path of [f.data, alias]) {
      const marker = `--managed-child=${path}`;
      child = spawn(process.execPath, [
        "-e",
        "setInterval(()=>{},1000)",
        "--",
        marker,
      ]);
      await once(child, "spawn");
      assert(child.pid);
      await writeJson(join(f.data, "control/child.json"), {
        pid: child.pid,
        marker,
      });
      await assert.rejects(
        activate(result.preparedFile),
        /Stop the managed child/,
      );
      child.kill("SIGKILL");
      await once(child, "exit");
      child = undefined;
    }
    await rm(join(f.data, "control/child.json"));
    const history = join(f.data, "control/history.json");
    const historyBytes = await readFile(history);
    await writeFile(history, "[]");
    await assert.rejects(activate(result.preparedFile), /Preparation is stale/);
    await writeFile(history, historyBytes);
    const build = join(paths.stage, "dist/index.html");
    const buildBytes = await readFile(build);
    await writeFile(build, "tampered");
    await assert.rejects(
      activate(result.preparedFile),
      /Prepared build changed/,
    );
    await writeFile(build, buildBytes);
    const core = join(paths.core, "core/auth.ts");
    await writeFile(core, "tampered");
    await writeJson(
      join(paths.core, "integrity.json"),
      await hashes(paths.core),
    );
    await assert.rejects(
      activate(result.preparedFile),
      /Prepared core changed/,
    );
    const altered = { ...p, coreFiles: await hashes(paths.core) };
    await writeJson(paths.prepared, altered);
    await assert.rejects(
      activate(paths.prepared),
      /Staged core differs from reviewed source/,
    );
  } finally {
    child?.kill("SIGKILL");
    await rm(f.root, { recursive: true, force: true });
  }
});

test("restore refuses foreign dependencies, control replacements and later releases", async () => {
  const f = await fixture();
  try {
    await changeSource(f.source);
    const result = await prepareFixture(f);
    const activated = await activate(result.preparedFile);
    const canonical = join(f.data, "dependencies/node_modules");
    const saved = join(f.root, "saved-pointer");
    await rename(canonical, saved);
    await symlink(await readlink(saved), canonical);
    await assert.rejects(
      restore(activated.journalFile),
      /Foreign dependency replacement/,
    );
    await rm(canonical);
    await rename(saved, canonical);
    const manifest = join(f.data, "control/manifest.json");
    const manifestBytes = await readFile(manifest);
    const state = await readState(f.data);
    await writeJson(manifest, {
      ...state,
      active: { ...state.active, release: "f".repeat(40) },
    });
    await assert.rejects(restore(activated.journalFile), /later release/);
    await writeFile(manifest, manifestBytes);
    const history = join(f.data, "control/history.json");
    const historyBytes = await readFile(history);
    await writeFile(history, "foreign controls");
    await assert.rejects(
      restore(activated.journalFile),
      /Foreign control replacement/,
    );
    await writeFile(history, historyBytes);
    await restore(activated.journalFile);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("interrupted directory rename and interrupted rollback recover from durable journal", async () => {
  const f = await fixture();
  try {
    await changeSource(f.source);
    const result = await prepareFixture(f);
    const activated = await activate(result.preparedFile);
    await restore(activated.journalFile);
    const journal = await readJournal(activated.journalFile);
    const paths = locations(journal.data, journal.id);
    assert.equal(journal.dependency.kind, "switch");
    if (
      journal.dependency.kind !== "switch" ||
      journal.dependency.replacement.kind !== "symlink"
    )
      throw new Error("fixture dependency plan");
    await symlink(
      journal.dependency.replacement.target,
      paths.temporaryDependencies,
    );
    const replacement = await identity(paths.temporaryDependencies);
    assert(replacement);
    const replay = {
      ...journal,
      dependency: { ...journal.dependency, replacement },
    };
    await writeJson(paths.journal, replay);
    await rename(paths.dependencies, paths.originalDependencies);
    await restore(paths.journal);
    assert.deepEqual(
      await identity(paths.dependencies),
      journal.dependency.original,
    );
    await symlink(
      journal.dependency.replacement.target,
      paths.temporaryDependencies,
    );
    const second = await identity(paths.temporaryDependencies);
    assert(second);
    const secondJournal = {
      ...journal,
      dependency: { ...journal.dependency, replacement: second },
    };
    await writeJson(paths.journal, secondJournal);
    await switchDependencies(secondJournal);
    await rename(paths.dependencies, paths.temporaryDependencies);
    await restore(paths.journal);
    await restore(paths.journal);
    assert.deepEqual(
      await identity(paths.dependencies),
      journal.dependency.original,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("complete dependency set is reused only after input, readiness and installed version checks", async () => {
  const f = await fixture();
  try {
    const before = join(f.root, "before");
    const stage = join(f.root, "stage");
    await fakeInputs(before);
    await fakeInputs(stage, true);
    let installs = 0;
    const installer = async (dir: string) => {
      installs++;
      await fakeInstaller(dir);
    };
    const dependency = await provision({
      data: f.data,
      before,
      stage,
      installer,
    });
    assert.deepEqual(
      await provision({ data: f.data, before, stage, installer }),
      dependency,
    );
    assert.equal(installs, 1);
    await writeJson(
      join(dependency.path, "@earendil-works/pi-ai/package.json"),
      { version: "2.0.0" },
    );
    await assert.rejects(
      provision({ data: f.data, before, stage, installer }),
      /Installed dependency version differs/,
    );
    await writeJson(join(stage, "package.json"), {
      dependencies: { "@earendil-works/pi-ai": "2.0.0" },
    });
    await assert.rejects(
      manifests(before, stage),
      /Required exact pin changed/,
    );
    await fakeInputs(stage, true);
    const manifest = zManifest(await readJson(join(stage, "package.json")));
    await writeJson(join(stage, "package.json"), {
      ...manifest,
      dependencies: { ...manifest.dependencies, addition: "^1.0.0" },
    });
    await assert.rejects(manifests(before, stage), /needs an exact version/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

const zManifest = (value: unknown) =>
  z
    .object({
      dependencies: z.record(z.string(), z.string()),
      devDependencies: z.record(z.string(), z.string()),
    })
    .parse(value);

test("dependency readiness refuses a missing Electron executable", async () => {
  const f = await fixture();
  try {
    const modules = join(f.data, "dependencies/node_modules");
    await rm(join(modules, "electron/dist/electron"));
    await assert.rejects(
      verifyInstalled(f.source, modules),
      /no usable executable/,
    );
    const before = Hashes.parse(
      await readJson(join(f.oldCore, "integrity.json")),
    );
    assert(before["core/auth.ts"]);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("exact dependency addition provisions a separate complete set and failed installs never switch", async () => {
  const f = await fixture();
  try {
    const stage = join(f.root, "addition");
    await fakeInputs(stage, true, { "owner-reviewed-addition": "1.2.3" });
    const original = await identity(join(f.data, "dependencies/node_modules"));
    const dependency = await provision({
      data: f.data,
      before: f.source,
      stage,
      installer: fakeInstaller,
    });
    assert.equal(
      z
        .object({ version: z.string() })
        .parse(
          await readJson(
            join(dependency.path, "owner-reviewed-addition/package.json"),
          ),
        ).version,
      "1.2.3",
    );
    const failed = join(f.root, "failed");
    await fakeInputs(failed, true, { "different-addition": "2.3.4" });
    await assert.rejects(
      provision({
        data: f.data,
        before: f.source,
        stage: failed,
        installer: async () => {
          throw new Error("bounded installer failed");
        },
      }),
      /bounded installer failed/,
    );
    await assert.rejects(
      provision({
        data: f.data,
        before: f.source,
        stage: failed,
        installer: fakeInstaller,
      }),
      /Dependency set is incomplete/,
    );
    assert.deepEqual(
      await identity(join(f.data, "dependencies/node_modules")),
      original,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("all three fixed manifest pins reject changes", async () => {
  const f = await fixture();
  try {
    const stage = join(f.root, "pins");
    for (const name of [
      "@earendil-works/pi-ai",
      "@earendil-works/pi-durable",
      "electron",
    ]) {
      await fakeInputs(stage, true);
      const manifest = zManifest(await readJson(join(stage, "package.json")));
      const section = name === "electron" ? "devDependencies" : "dependencies";
      manifest[section][name] = "99.0.0";
      await writeJson(join(stage, "package.json"), manifest);
      await assert.rejects(
        manifests(f.source, stage),
        /Required exact pin changed/,
      );
    }
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("dependency version validation rejects a symlinked package manifest", async () => {
  const f = await fixture();
  try {
    const manifest = join(
      f.data,
      "dependencies/node_modules/@earendil-works/pi-ai/package.json",
    );
    const saved = join(f.root, "saved-package.json");
    await rename(manifest, saved);
    await symlink(saved, manifest);
    await assert.rejects(
      verifyInstalled(f.source, join(f.data, "dependencies/node_modules")),
      /Symlink refused/,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
