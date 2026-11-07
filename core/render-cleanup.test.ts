import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { renderCandidate } from "./render/index.ts";

test("a failing render removes its scratch directory", async () => {
  const stage = await mkdtemp("/private/tmp/gaia-render-cleanup-");
  try {
    await assert.rejects(
      renderCandidate({
        stage,
        core: resolve("."),
        dependencies: resolve("node_modules"),
      }),
    );
    assert.deepEqual(
      (await readdir(join(stage, "dist"))).filter((name) =>
        name.startsWith(".render-"),
      ),
      [],
    );
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
});

test("preview retention keeps one active cache and at most ten changes", async () => {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { prunePreviews } = await import("./preview.ts");
  const data = await mkdtemp("/private/tmp/gaia-retention-");
  try {
    for (const kind of ["before", "baseline", "changes"])
      for (let i = 0; i < 15; i++) {
        const folder = join(data, "previews", kind, String(i));
        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, "image.jpg"), "fixture");
      }
    await prunePreviews(data, "0", "1", "2");
    assert.deepEqual(await readdir(join(data, "previews/baseline")), ["0"]);
    assert.deepEqual(await readdir(join(data, "previews/before")), ["1"]);
    assert.equal((await readdir(join(data, "previews/changes"))).length, 10);
    await prunePreviews(data, "0", "1", "2");
    assert.equal((await readdir(join(data, "previews/changes"))).length, 10);
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});

test("an expired preview deadline refuses before starting renderer work", async () => {
  const stage = await mkdtemp("/private/tmp/gaia-render-deadline-");
  try {
    await assert.rejects(
      renderCandidate({
        stage,
        core: resolve("."),
        dependencies: resolve("node_modules"),
        deadline: Date.now() - 1,
      }),
      /Preview deadline exceeded/,
    );
    await assert.rejects(readdir(join(stage, "dist")), /ENOENT/);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
});
