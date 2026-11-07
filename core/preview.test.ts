import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Supervisor } from "./supervisor.ts";
import { Change, Command } from "./state.ts";
import { sourceIdentity } from "./preview.ts";
import { command } from "./process.ts";

export async function previewFixture() {
  const data = await mkdtemp("/private/tmp/gaia-preview-");
  const repo = join(data, "repo");
  await mkdir(join(repo, "apps/web"), { recursive: true });
  await writeFile(join(repo, "apps/web/fixture.css"), ".target { color: var(--color-ink); }\n");
  for (const args of [["init", "-q"], ["config", "user.email", "gaia@localhost"], ["config", "user.name", "Gaia test"], ["add", "."], ["commit", "-qm", "fixture"]]) await command("git", args, repo);
  const release = await command("git", ["rev-parse", "HEAD"], repo);
  await mkdir(join(data, "releases"));
  await symlink(repo, join(data, "releases", release));
  const supervisor = new Supervisor({ data, core: resolve("."), dependencies: resolve("node_modules"), host: "127.0.0.1", port: 0, testProvider: true });
  const pair = { release, generation: randomUUID(), schema: 1 as const };
  supervisor.state = { kind: "stable", active: pair, good: pair, failures: 0 };
  return { data, repo, supervisor };
}

test("UI submit requires a preview for the exact source, including unstaged and new files", async () => {
  const f = await previewFixture();
  try {
    const change = Change.parse(await f.supervisor.handle({ kind: "stage", reason: "Preview guard proof", edits: [{ path: "apps/web/fixture.css", find: "--color-ink", replace: "--color-ink-2" }] }));
    await assert.rejects(f.supervisor.handle({ kind: "submit", id: change.id }), /apps\/web: a matching preview is required/);
    assert.equal(f.supervisor.busy, false);
    const stage = join(f.data, "staging", change.id), original = await readFile(join(stage, "apps/web/fixture.css"), "utf8"), hash = await sourceIdentity(stage);
    await writeFile(join(stage, "apps/web/fixture.css"), original + "\n/* stale */");
    assert.notEqual(await sourceIdentity(stage), hash);
    await writeFile(join(stage, "apps/web/fixture.css"), original);
    assert.equal(await sourceIdentity(stage), hash);
    await writeFile(join(stage, "apps/web/untracked.ts"), "export const added = true;");
    assert.notEqual(await sourceIdentity(stage), hash);
    const entry = f.supervisor.history.find(entry => entry.id === change.id)!;
    entry.previews = { hash, surfaces: [], shots: [], alsoChanged: [] };
    await assert.rejects(f.supervisor.handle({ kind: "submit", id: change.id }), /matching preview/);
    assert.equal(f.supervisor.state.kind, "stable");
    assert.equal(f.supervisor.child, undefined);
    assert.equal(f.supervisor.history[0].outcome, "staged");
    assert(!Command.safeParse({ kind: "preview", id: change.id, surfaces: [{ name: "empty", steps: [] }] }).success);
    assert(!Command.safeParse({ kind: "preview", id: change.id, surfaces: [{ name: "tasks", steps: [{ kind: "evaluate", code: "unsafe" }] }] }).success);
  } finally { await rm(f.data, { recursive: true, force: true }); }
});
