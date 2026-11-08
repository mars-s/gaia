import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, symlink, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Supervisor } from "../../core/supervisor.ts";
import { Change } from "../../core/state.ts";
import { command } from "../../core/process.ts";
import { hashes, importable } from "../../core/install.ts";

test("preview binds hidden fixture shots to source, reuses before shots and leaves the live child alone", { skip: process.platform !== "darwin", timeout: 180000 }, async () => {
  const data = await mkdtemp("/private/tmp/gaia-preview-native-"), repo = join(data, "repo");
  try {
    await mkdir(repo);
    for (const path of ["apps", "packages", "core", "selfmod", "package.json", "package-lock.json", "tsconfig.json", "eslint.config.js", "vite.config.ts", "LICENSE"]) await cp(resolve(path), join(repo, path), { recursive: true, filter: importable });
    for (const args of [["init", "-q"], ["config", "user.email", "gaia@localhost"], ["config", "user.name", "Gaia test"], ["add", "."], ["commit", "-qm", "fixture"]]) await command("git", args, repo);
    const release = await command("git", ["rev-parse", "HEAD"], repo);
    await symlink(resolve("node_modules"), join(repo, "node_modules"));
    await mkdir(join(data, "releases"));
    await command("git", ["worktree", "add", "--detach", join(data, "releases", release), release], repo);
    await symlink(resolve("node_modules"), join(data, "releases", release, "node_modules"));
    const supervisor = new Supervisor({ data, core: resolve("."), dependencies: resolve("node_modules"), host: "127.0.0.1", port: 0, testProvider: true });
    Object.assign(supervisor, { protected: await hashes(repo) });
    const pair = { release, generation: randomUUID(), schema: 1 as const };
    supervisor.state = { kind: "stable", active: pair, good: pair, failures: 0 };
    const original = await readFile(join(repo, "apps/web/styles/theme.css"), "utf8");
    const stage = Change.parse(await supervisor.handle({ kind: "stage", reason: "Preview the accent", edits: [{ path: "apps/web/styles/theme.css", text: original + "\n/* Preview identity proof */\n" }] }));
    const raw = await supervisor.handle({ kind: "preview", id: stage.id });
    const { z } = await import("zod");
    assert.equal(z.object({ images: z.array(z.object({ name: z.string(), data: z.string().min(1000), mimeType: z.literal("image/jpeg") })) }).parse(raw).images.length, 40);
    const result = Change.parse(raw);
    assert.equal(result.previews?.shots.length, 20);
    assert.deepEqual(result.previews?.alsoChanged, []);
    const before = join(data, "previews/before"), keys = await readdir(before);
    assert.equal(keys.length, 1);
    const baseline = join(data, "previews/baseline", release);
    for (const scenario of await readdir(baseline)) {
      if (scenario === "ready") continue;
      const files = await readdir(join(baseline, scenario));
      assert.equal(files.length, 8);
      assert(files.every(file => /\.(png|jpg)$/.test(file)), "baseline cache must contain images only");
    }
    const ready = await readFile(join(before, keys[0], "ready"), "utf8");
    assert.equal(ready, release);
    for (const shot of result.previews!.shots) for (const side of [shot.before, shot.after]) {
      const bytes = await readFile(join(data, "previews/changes", stage.id, side));
      assert.equal(bytes.subarray(0, 2).toString("hex"), "ffd8");
      assert(bytes.length > 1000);
    }
    const again = Change.parse(await supervisor.handle({ kind: "preview", id: stage.id }));
    assert.deepEqual(again.previews, result.previews);
    assert.deepEqual(await readdir(before), keys);
    assert.equal(supervisor.state.active.release, release);
    assert.equal(supervisor.state.kind, "stable");
    assert.equal(supervisor.child, undefined);
    assert.equal(await readFile(join(repo, "apps/web/styles/theme.css"), "utf8"), original);
    const tint = Change.parse(await supervisor.handle({ kind: "stage", reason: "Preview a visible page tint", edits: [{ path: "apps/web/styles/theme.css", text: original.replace("--color-surface-page: var(--color-white);", "--color-surface-page: var(--color-neutral-50);") }] }));
    const tinted = Change.parse(await supervisor.handle({ kind: "preview", id: tint.id }));
    assert(tinted.previews?.alsoChanged.includes("empty-1000-light"), "baseline changes above half a percent must reach the card and critic");
    assert.deepEqual(await readdir(before), keys, "another stage from the same release reuses before shots");
  } finally { await rm(data, { recursive: true, force: true }); }
});
