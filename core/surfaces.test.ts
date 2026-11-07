import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Surfaces } from "./render/schema.ts";
import * as schema from "./render/schema.ts";

test("seven persisted surface declarations survive unrelated changes and revert", async () => {
  const root = await mkdtemp("/private/tmp/gaia-surfaces-");
  try {
    const surfaces = Array.from({ length: 7 }, (_, i) => ({ name: `surface-${i}`, steps: [] }));
    assert.equal(Surfaces.parse(surfaces).length, 7);
    for (const surface of surfaces) {
      const folder = join(root, "apps/web/surfaces", surface.name);
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "render.json"), JSON.stringify(surface));
    }
    assert("readSurfaces" in schema);
    const read = schema.readSurfaces as (root: string) => Promise<unknown>;
    assert.deepEqual(await read(root), surfaces);
    await writeFile(join(root, "unrelated.ts"), "server change");
    assert.deepEqual(await read(root), surfaces);
    await rm(join(root, "unrelated.ts"));
    assert.deepEqual(await read(root), surfaces);
    await writeFile(join(root, "apps/web/surfaces/surface-0/render.json"), '{"name":"other","steps":[]}');
    await assert.rejects(read(root), /name/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
