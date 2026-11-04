import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  cp,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";
import { sandboxProfile } from "./sandbox.ts";
import { command } from "./process.ts";
import { importable, safeFile } from "./install.ts";
import { createChatServer, openDatabase } from "../apps/server/server.ts";
import { probes, reconnect } from "./probes.ts";
const root = resolve(".");
test(
  "sandbox policy stays outside the writable candidate across launches",
  { skip: process.platform !== "darwin" },
  async () => {
    const dir = await mkdtemp(
      join(
        process.platform === "darwin" ? "/private/tmp" : tmpdir(),
        "gaia-policy-",
      ),
    );
    try {
      const stage = join(dir, "stage");
      const core = join(dir, "protected");
      await mkdir(stage);
      await mkdir(core);
      const profile = await sandboxProfile(
        stage,
        core,
        join(root, "node_modules"),
      );
      const sentinel = join(dir, "outside");
      await writeFile(sentinel, "original");
      await writeFile(join(stage, "source.ts"), "verified source");
      const attack = join(stage, "attack.mjs");
      await writeFile(
        attack,
        `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(join(stage, ".scratch/.sandbox.sb"))}, '(version 1)(allow default)'); let denied=false; try { writeFileSync(${JSON.stringify(profile)}, '(version 1)(allow default)'); } catch(e) {denied=e.code==='EPERM';} if(!denied) throw Error('Policy overwritten'); let sourceDenied=false; try {writeFileSync(${JSON.stringify(join(stage, "source.ts"))}, 'unverified source');} catch(e) {sourceDenied=e.code==='EPERM';} if(!sourceDenied) throw Error('Source mutated after checks');`,
      );
      await command(
        "/usr/bin/sandbox-exec",
        ["-f", profile, process.execPath, attack],
        stage,
      );
      await writeFile(
        attack,
        `import {writeFileSync} from 'node:fs'; let denied=false; try {writeFileSync(${JSON.stringify(sentinel)}, 'escaped');} catch(e) {denied=e.code==='EPERM';} if(!denied) throw Error('Escaped');`,
      );
      await command(
        "/usr/bin/sandbox-exec",
        ["-f", profile, process.execPath, attack],
        stage,
      );
      assert.equal(await readFile(sentinel, "utf8"), "original");
      assert.equal(
        await readFile(join(stage, "source.ts"), "utf8"),
        "verified source",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
test("baseline import filter excludes nested secrets and supported API refuses traversal and symlinks", async () => {
  const dir = await mkdtemp(
    join(
      process.platform === "darwin" ? "/private/tmp" : tmpdir(),
      "gaia-paths-",
    ),
  );
  try {
    const source = join(dir, "source");
    const target = join(dir, "target");
    await mkdir(join(source, "apps/server/nested"), { recursive: true });
    await writeFile(
      join(source, "apps/server/nested/.env.local"),
      "SENTINEL_SECRET",
    );
    await writeFile(
      join(source, "apps/server/nested/private.key"),
      "SENTINEL_KEY",
    );
    await writeFile(join(source, "apps/server/server.ts"), "source");
    await cp(source, target, { recursive: true, filter: importable });
    await command("git", ["init", "-q"], target);
    await command("git", ["add", "."], target);
    assert.equal(
      await command("git", ["ls-files"], target),
      "apps/server/server.ts",
    );
    for (const path of [
      "../core/auth.ts",
      "/tmp/file",
      "apps/server/../../core/auth.ts",
      "core/auth.ts",
      "apps/server/auth.ts",
      "apps/server/foo.test.ts",
      "package.json",
    ])
      await assert.rejects(safeFile(target, path));
    await symlink(dir, join(target, "apps/server/link"));
    await assert.rejects(
      safeFile(target, "apps/server/link/outside.ts"),
      /Symlinks/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("closing a never-listened probe server disposes adapter, auth and SQLite", async () => {
  const dir = await mkdtemp(
    join(
      process.platform === "darwin" ? "/private/tmp" : tmpdir(),
      "gaia-close-",
    ),
  );
  const db = await openDatabase(dir);
  let adapterClosed = false;
  let authClosed = false;
  const app = createChatServer({
    db,
    origins: [],
    adapter: {
      async run() {},
      async close() {
        adapterClosed = true;
      },
    },
    auth: {
      status: () => ({ kind: "disconnected", message: "test" }),
      connect() {},
      reply() {},
      async close() {
        authClosed = true;
      },
    },
  });
  try {
    await app.close();
    assert(adapterClosed);
    assert(authClosed);
    assert.throws(() => db.prepare("SELECT 1"), /not open/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("reconnect decodes a split Unicode snapshot from a new real SSE connection", async () => {
  let streams = 0;
  const server = createServer((req, res) => {
    if (req.url === "/healthz")
      return res.end(
        JSON.stringify({ ok: true, release: "release", schema: 1 }),
      );
    const value = {
      thread: {
        version: 1,
        id: "local",
        messages: [
          {
            id: "one",
            role: "assistant",
            text: "Reply with exactly: Gaia readiness",
            createdAt: "now",
          },
        ],
        run: { kind: "idle" },
      },
      connection: { kind: "connected", model: "gpt-6.1-sol" },
      runtime: { release: "release", mode: "probing", selfModification: false },
    };
    if (req.url === "/api/v1/probe/messages") {
      let text = "";
      req.setEncoding("utf8");
      req.on("data", (part) => {
        text += part;
      });
      req.on("end", () => {
        const input = JSON.parse(text);
        message = input.text;
        res.writeHead(202);
        res.end(JSON.stringify(value));
      });
      return;
    }
    value.thread.messages[0].text = message;
    if (req.url === "/api/v1/events") {
      streams++;
      value.thread.messages[0].text = "🌱 café";
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "X-Gaia-Release": "release",
      });
      const payload = Buffer.from(
        `data: ${JSON.stringify({ type: "snapshot", data: value })}\n\n`,
      );
      const index = payload.indexOf(Buffer.from("🌱")) + 2;
      res.write(payload.subarray(0, index));
      setTimeout(() => res.end(payload.subarray(index)), 15);
      return;
    }
    res.end(JSON.stringify(value));
  });
  let message = "";
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  try {
    await probes(`http://127.0.0.1:${address.port}`, "release", "token", 2000);
    const snapshot = await reconnect(
      `http://127.0.0.1:${address.port}`,
      "release",
    );
    assert.equal(snapshot.thread.messages[0]?.text, "🌱 café");
    assert.equal(streams, 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("protected file hashes reject tampering and schema version guard rejects incompatible databases", async () => {
  const { hashes, verifyProtected } = await import("./install.ts");
  const { compatible } = await import("./schema.ts");
  const dir = await mkdtemp(
    join(
      process.platform === "darwin" ? "/private/tmp" : tmpdir(),
      "gaia-protected-",
    ),
  );
  try {
    await mkdir(join(dir, "core"));
    await writeFile(join(dir, "core/auth.ts"), "protected");
    const expected = await hashes(dir);
    await writeFile(join(dir, "core/auth.ts"), "tampered");
    await assert.rejects(
      verifyProtected(dir, expected),
      /Protected file changed/,
    );
    const before = join(dir, "before");
    const after = join(dir, "after");
    const a = await openDatabase(before);
    const b = await openDatabase(after);
    a.exec("CREATE TABLE example (id TEXT)");
    b.exec("CREATE TABLE example (id TEXT); PRAGMA user_version=2");
    a.close();
    b.close();
    await assert.rejects(compatible(before, after), /Schema version/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
