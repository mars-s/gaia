import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, copyFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { recipe } from "./recipe.ts";

test("the real recipe returns a failing unit assertion in checks and stops before build", { skip: process.platform !== "darwin" }, async () => {
  const root = await mkdtemp("/private/tmp/gaia-recipe-detail-");
  const stage = join(root, "stage");
  const core = join(root, "core");
  const dependencies = resolve("node_modules");
  const checks: string[] = [];
  try {
    await Promise.all([mkdir(join(stage, "apps/web"), { recursive: true }), mkdir(join(stage, "apps/server"), { recursive: true }), mkdir(core)]);
    for (const directory of ["packages", "core", "selfmod"]) {
      await mkdir(join(stage, directory));
      await writeFile(join(stage, directory, "fixture.ts"), "export {};\n");
    }
    await Promise.all([
      symlink(dependencies, join(stage, "node_modules")),
      symlink(dependencies, join(core, "node_modules")),
      writeFile(join(stage, "package.json"), '{"type":"module"}'),
      writeFile(join(core, "package.json"), '{"type":"module"}'),
      writeFile(join(core, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", skipLibCheck: true, noEmit: true } })),
      copyFile("eslint.config.js", join(core, "eslint.config.js")),
      writeFile(join(stage, "apps/web/failure.test.ts"), 'import {test} from "node:test"; import assert from "node:assert/strict"; test("planted assertion", () => assert.equal("actual", "EXPECTED_RECIPE_DETAIL"));'),
    ]);
    await assert.rejects(recipe({ stage, core, dependencies, release: "fixture", record: async (result) => { checks.push(result); } }));
    assert.deepEqual(checks.slice(0, 2), ["typecheck: passed", "lint: passed"]);
    assert.equal(checks.length, 3);
    assert.match(checks[2], /^unit tests: failed\n/);
    assert.match(checks[2], /EXPECTED_RECIPE_DETAIL/);
    assert.match(checks[2], /apps\/web\/failure.test.ts/);
    assert.doesNotMatch(checks[2], new RegExp(stage));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
