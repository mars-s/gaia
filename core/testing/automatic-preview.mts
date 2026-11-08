import { mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as processTools from "../process.ts";
import * as previews from "../preview.ts";
import * as sandbox from "../sandbox.ts";
import * as install from "../install.ts";
import { readSurfaces } from "../render/schema.ts";
import type { Change as ChangeEntry } from "../state.ts";
import { randomUUID } from "node:crypto";
const root = await mkdtemp("/private/tmp/gaia-advisory-");
let renders = 0;
let bad = false;
let previewError = "Preview deadline exceeded";
mock.module("../process.ts", {
  namedExports: {
    ...processTools,
    command: async (file: string, args: string[], cwd: string) =>
      file === "/usr/bin/sandbox-exec"
        ? ""
        : processTools.command(file, args, cwd),
  },
});
mock.module("../preview.ts", {
  namedExports: {
    ...previews,
    previewChange: async () => {
      throw new Error(previewError);
    },
  },
});
mock.module("../install.ts", {
  namedExports: { ...install, verifyProtected: async () => {} },
});
mock.module("../sandbox.ts", {
  namedExports: {
    ...sandbox,
    sandboxProfile: async () => "",
    candidateBoot: async () => {},
  },
});
mock.module("../design/pack.ts", {
  namedExports: { designPack: async () => "" },
});
mock.module("../probes.ts", { namedExports: { probes: async () => {} } });
mock.module("../schema.ts", { namedExports: { compatible: async () => {} } });
mock.module("../render/index.ts", {
  namedExports: {
    renderCandidate: async (options: {
      surfaces: unknown[];
      deadline?: number;
    }) => {
      renders++;
      assert.equal(options.surfaces.length, 12);
      assert.equal(options.deadline, undefined);
      if (bad) throw new Error("Bad rendered change");
      return { scratch: join(root, "scratch") };
    },
  },
});
mock.module("../recipe.ts", {
  namedExports: {
    recipe: (await import("../recipe.ts" + "?automatic-preview")).recipe,
  },
});
const { Supervisor } = await import("../supervisor.ts");
const { Change } = await import("../state.ts");
try {
  const repo = join(root, "repo");
  await mkdir(join(repo, "apps/web"), { recursive: true });
  await mkdir(join(repo, "apps/server"), { recursive: true });
  await writeFile(
    join(repo, "tsconfig.json"),
    JSON.stringify({ compilerOptions: {} }),
  );
  await writeFile(join(repo, "apps/server/fixture.ts"), "export {};");
  await writeFile(join(repo, "apps/web/fixture.css"), "body { color: black; }");
  for (let i = 0; i < 12; i++) {
    const folder = join(repo, "apps/web/surfaces", `surface-${i}`);
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "render.json"),
      JSON.stringify({ name: `surface-${i}`, steps: [] }),
    );
  }
  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "gaia@localhost"],
    ["config", "user.name", "Gaia test"],
    ["add", "."],
    ["commit", "-qm", "baseline"],
  ])
    await processTools.command("git", args, repo);
  const base = await processTools.command("git", ["rev-parse", "HEAD"], repo);
  await writeFile(join(repo, "apps/web/fixture.css"), "body { color: blue; }");
  await processTools.command("git", ["commit", "-am", "UI change"], repo);
  const release = await processTools.command(
    "git",
    ["rev-parse", "HEAD"],
    repo,
  );
  const generation = randomUUID();
  await mkdir(join(root, "generations", generation), { recursive: true });
  await mkdir(join(root, "releases"));
  const supervisor = new Supervisor({
    data: root,
    core: repo,
    dependencies: resolve("node_modules"),
    host: "127.0.0.1",
    port: 0,
    testProvider: true,
  });
  const internal = supervisor as unknown as {
    revert: (entry: ChangeEntry) => Promise<ChangeEntry>;
    promote: (entry: ChangeEntry) => Promise<void>;
    drain: () => Promise<void>;
    halt: () => Promise<void>;
    boot: () => Promise<void>;
  };
  internal.drain = internal.halt = internal.boot = async () => {};
  for (const failure of [
    "Preview deadline exceeded",
    "Renderer unavailable",
    "Preview deadline exceeded",
  ]) {
    previewError = failure;
    bad = renders === 2;
    const pair = { release, generation, schema: 1 as const };
    supervisor.state = {
      kind: "stable",
      active: pair,
      good: pair,
      failures: 0,
    };
    const original = Change.parse({
      id: randomUUID(),
      reason: `UI change ${renders}`,
      at: new Date().toISOString(),
      base,
      commit: release,
      diff: "",
      checks: [],
      outcome: "accepted",
      detail: "",
    });
    const entry = await internal.revert(original);
    assert.equal(
      (await readSurfaces(join(root, "staging", entry.id))).length,
      12,
    );
    await internal.promote(entry);
    assert.equal(entry.outcome, bad ? "rejected" : "accepted", entry.detail);
    assert.equal(supervisor.state.failures, bad ? 1 : 0);
    assert(
      entry.checks.some((check) =>
        check.startsWith("preview images unavailable"),
      ),
    );
    assert(
      entry.checks.some((check) =>
        check.startsWith(
          `rendered design checks: ${bad ? "failed" : "passed"}`,
        ),
      ),
    );
    assert.equal(entry.previews, undefined);
    console.log(
      `${entry.outcome}: ${failure}; 12 surfaces; full render ${bad ? "blocked bad change" : "passed"}; failures=${supervisor.state.failures}`,
    );
  }
  assert.equal(renders, 3);
} finally {
  await rm(root, { recursive: true, force: true });
}
