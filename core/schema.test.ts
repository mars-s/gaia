import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { compatible, schemas } from "./schema.ts";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "gaia-profile-schemas-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = join(root, "before");
  const after = join(root, "after");
  const profile = randomUUID();
  async function database(directory: string, path = "pi.sqlite", extra = "") {
    const target = join(directory, path);
    await mkdir(join(target, ".."), { recursive: true });
    const db = new DatabaseSync(target);
    try {
      db.exec(
        "CREATE TABLE durable_state (id INTEGER PRIMARY KEY, value TEXT)",
      );
      if (extra) db.exec(extra);
    } finally {
      db.close();
    }
    return target;
  }
  await database(before);
  await database(after);
  const path = join("experiences", profile, "pi.sqlite");
  return { before, after, path, database };
}

test("nested profile schema changes are refused before promotion", async (t) => {
  for (const mutation of [
    "PRAGMA user_version=2",
    "ALTER TABLE durable_state ADD COLUMN incompatible TEXT",
  ]) {
    const f = await fixture(t);
    await f.database(f.before, f.path);
    await f.database(f.after, f.path, mutation);
    await assert.rejects(compatible(f.before, f.after), /Schema version/);
  }
});

test("safe mode accepts a new profile only with the known Pi schema", async (t) => {
  const f = await fixture(t);
  await f.database(f.after, f.path);
  await compatible(f.before, f.after);
  assert.equal(
    (await schemas(f.after))[f.path],
    (await schemas(f.before))["pi.sqlite"],
  );
  const db = new DatabaseSync(join(f.after, f.path));
  db.exec("CREATE TABLE incompatible (value TEXT)");
  db.close();
  await assert.rejects(compatible(f.before, f.after), /Schema version/);
});

test("removing a profile database cannot pass compatibility", async (t) => {
  const f = await fixture(t);
  await f.database(f.before, f.path);
  await assert.rejects(compatible(f.before, f.after), /Schema version/);
});

test("profile storage refuses directory and database symlinks", async (t) => {
  const f = await fixture(t);
  const external = join(f.before, "external");
  await f.database(external);
  await mkdir(join(f.after, "experiences"));
  await symlink(external, join(f.after, "experiences", randomUUID()));
  await assert.rejects(schemas(f.after), /Symlink/);
  await rm(join(f.after, "experiences"), { recursive: true });
  await mkdir(join(f.after, f.path, ".."), { recursive: true });
  await symlink(join(external, "pi.sqlite"), join(f.after, f.path));
  await assert.rejects(schemas(f.after), /Symlink/);
});
