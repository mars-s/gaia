import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { importBaseline, installCore } from "./install.ts";
import { command } from "./process.ts";

test(
  "a data directory inside a checkout gets its own repository and protected file inventory",
  { skip: process.platform !== "darwin" },
  async () => {
    const temporary = await mkdtemp(
      join("/private/tmp", "gaia-nested-import-"),
    );
    const source = resolve(".");
    const dependencies = join(source, "node_modules");
    const parent = join(temporary, "parent");
    const data = join(parent, "data");
    const core = join(temporary, "protected");
    try {
      await command(
        "git",
        ["clone", "--quiet", "--no-hardlinks", source, parent],
        temporary,
      );
      const parentHead = await command("git", ["rev-parse", "HEAD"], parent);
      for (const name of ["control", "credentials", "releases", "generations"])
        await mkdir(join(data, name), { recursive: true });
      await installCore(source, core, dependencies);
      await importBaseline(source, data, core, dependencies);
      assert.equal(
        await command(
          "git",
          ["rev-parse", "--show-toplevel"],
          join(data, "repo"),
        ),
        await realpath(join(data, "repo")),
      );
      assert.equal(
        await command("git", ["rev-parse", "HEAD"], parent),
        parentHead,
      );
      const protectedFiles = JSON.parse(
        await readFile(join(data, "control/protected.json"), "utf8"),
      );
      assert(protectedFiles["core/supervisor.ts"]);
      assert(protectedFiles["core/auth.ts"]);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

test("an external worktree git pointer is refused rather than initialised over", async () => {
  const data = await mkdtemp(join(tmpdir(), "gaia-git-pointer-"));
  try {
    await mkdir(join(data, "repo"));
    const pointer = "gitdir: /outside/repository\n";
    await writeFile(join(data, "repo/.git"), pointer);
    await assert.rejects(
      importBaseline("unused", data, "unused", "unused"),
      /must own its \.git directory/,
    );
    assert.equal(await readFile(join(data, "repo/.git"), "utf8"), pointer);
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});
