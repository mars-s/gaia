import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Command, Edit, Change, patchText } from "./state.ts";
import { Supervisor } from "./supervisor.ts";
import { command } from "./process.ts";

test("patches require exactly one literal match, including overlapping matches", () => {
  for (const [source, find] of [
    ["abc", "missing"],
    ["abc abc", "abc"],
    ["aaa", "aa"],
  ])
    assert.throws(
      () =>
        patchText(
          source,
          Edit.parse({ path: "apps/web/style.css", find, replace: "changed" }),
        ),
      /exactly one/,
    );
  assert.equal(
    patchText("before $& after", {
      path: "apps/web/style.css",
      find: "$&",
      replace: "$` literal",
    }),
    "before $` literal after",
  );
  for (const edit of [
    { path: "a", find: "", replace: "b" },
    { path: "a", text: "a", find: "a", replace: "b" },
  ])
    assert(!Edit.safeParse(edit).success);
});
test("real staging patches current source, retains other bytes and refuses protected paths", async () => {
  const data = await mkdtemp("/private/tmp/gaia-patch-");
  try {
    const repo = join(data, "repo");
    await mkdir(join(repo, "apps/web"), { recursive: true });
    const path = "apps/web/fixture.css",
      source = "/* unchanged */\n.target { color: var(--color-ink); }\n";
    await writeFile(join(repo, path), source);
    for (const args of [
      ["init", "-q"],
      ["config", "user.email", "gaia@localhost"],
      ["config", "user.name", "Gaia test"],
      ["add", "."],
      ["commit", "-qm", "fixture"],
    ])
      await command("git", args, repo);
    const release = await command("git", ["rev-parse", "HEAD"], repo);
    await mkdir(join(data, "releases"));
    await symlink(repo, join(data, "releases", release));
    const supervisor = new Supervisor({
      data,
      core: resolve("."),
      dependencies: resolve("node_modules"),
      host: "127.0.0.1",
      port: 0,
      testProvider: true,
    });
    const pair = { release, generation: randomUUID(), schema: 1 as const };
    supervisor.state = {
      kind: "stable",
      active: pair,
      good: pair,
      failures: 0,
    };
    const stage = (path: string, find: string) =>
      supervisor.handle(
        Command.parse({
          kind: "stage",
          reason: "Patch proof",
          edits: [{ path, find, replace: "--color-ink-2" }],
        }),
      );
    for (const path of [
      "core/recipe.ts",
      "apps/server/auth.ts",
      "apps/web/fixture.test.ts",
      "../apps/web/fixture.css",
    ])
      await assert.rejects(
        stage(path, "--color-ink"),
        /Protected or invalid path/,
      );
    await assert.rejects(stage(path, "missing"), /exactly one/);
    const change = Change.parse(await stage(path, "--color-ink"));
    assert.equal(
      await readFile(join(data, "staging", change.id, path), "utf8"),
      source.replace("--color-ink", "--color-ink-2"),
    );
    assert.equal(await readFile(join(repo, path), "utf8"), source);
    assert.match(change.diff, /color-ink-2/);
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});
