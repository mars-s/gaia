import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { installCore } from "./install.ts";
import { freePort, sandboxProfile } from "./sandbox.ts";
import { atomic, Command } from "./state.ts";
import { command, cleanEnv } from "./process.ts";

for (const leased of [true, false]) test(`managed child lease flag ${leased} strips keys and keeps auth isolated`, { timeout: 30000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "gl-child-"));
  const source = resolve(".");
  const core = join(root, "core");
  const release = join(root, "release");
  const data = join(root, "data");
  const generationId = randomUUID();
  const generation = join(data, "generations", generationId);
  await installCore(source, core, join(source, "node_modules"));
  await mkdir(join(release, "apps/server"), { recursive: true });
  await mkdir(generation, { recursive: true });
  await writeFile(join(release, "package.json"), '{"type":"module"}');
  await writeFile(join(release, "apps/server/server.ts"), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(join(root, "env.json"))}, JSON.stringify(process.env)); export {createChatServer,openDatabase} from ${JSON.stringify(join(source, "apps/server/server.ts"))};`);
  await writeFile(join(release, "apps/server/pi.ts"), `import {writeFileSync} from 'node:fs'; import {createPi as real} from ${JSON.stringify(join(source, "apps/server/pi.ts"))}; export function createPi(...args) { writeFileSync(${JSON.stringify(join(root, "machine.json"))}, JSON.stringify({enabled:!!args[4]?.tools})); return real(...args); }`);
  const pair = { release: "a".repeat(40), generation: generationId, schema: 1 };
  await atomic(join(data, "control/manifest.json"), { kind: "stable", active: pair, good: pair, failures: 0 });
  const port = await freePort();
  const credentials = join(root, "oauth.sqlite");
  const child = spawn(process.execPath, ["--import", join(source, "node_modules/tsx/dist/loader.mjs"), join(core, "core/child.ts"), ...(leased ? ["--plan-lease"] : [])], { stdio: ["ignore", "pipe", "pipe", "ipc"], env: { ...cleanEnv(), GAIA_RELEASE: pair.release, GAIA_RELEASE_DIR: release, GAIA_GENERATION: generation, GAIA_DATA_DIR: data, GAIA_CREDENTIALS: credentials, GAIA_HOST: "127.0.0.1", GAIA_PORT: String(port), GAIA_PROBE_TOKEN: "test", GAIA_CONTROL_SOCKET: join(root, "control.sock"), GAIA_PLAN_LEASE_SOCKET: join(root, "missing.sock"), GAIA_PLAN_LEASE_KEY: "x".repeat(43), GAIA_PLAN_LEASE_PROVIDER: "openai-codex" } });
  const exited = once(child, "exit");
  let logs = "";
  child.stdout?.on("data", (chunk) => { logs += chunk; });
  child.stderr?.on("data", (chunk) => { logs += chunk; });
  t.after(async () => { child.kill("SIGTERM"); const timeout = setTimeout(() => child.kill("SIGKILL"), 5000); await exited; clearTimeout(timeout); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  let health;
  for (let i = 0; i < 200; i++) {
    try { health = await (await fetch(base + "/healthz")).json(); break; } catch { await new Promise((resolve) => setTimeout(resolve, 25)); }
  }
  assert(health, logs);
  assert.equal(health.mode, "stable");
  assert.equal(health.planLease, leased ? true : undefined);
  const env = JSON.parse(await readFile(join(root, "env.json"), "utf8"));
  assert.equal(env.GAIA_PLAN_LEASE_KEY, leased ? undefined : "x".repeat(43));
  const request = (path: string, body?: unknown) => fetch(base + "/api/v1/" + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (leased) {
    assert.deepEqual(JSON.parse(await readFile(join(root, "machine.json"), "utf8")), { enabled: false });
    assert.equal((await request("auth/disconnect", { provider: "openai-codex" })).status, 409);
    await request("auth/connect", { provider: "openai-codex" });
    const initial = await (await request("state")).json();
    assert.match(JSON.stringify(initial), /Sign-in is off in this test copy/);
    await request("messages", { requestId: randomUUID(), text: "Synthetic auth failure" });
    let state = initial;
    for (let i = 0; i < 200; i++) {
      state = await (await request("state")).json();
      if (state.thread.run.kind === "error") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(state.thread.run.kind, "error");
    assert.deepEqual(state.thread.run, { kind: "error", message: "Sol could not finish this reply. Check your plan connection, then retry." });
    assert.equal((await (await fetch(base + "/healthz")).json()).mode, "stable");
  }
  const db = new DatabaseSync(credentials, { readOnly: true });
  assert.equal(db.prepare("SELECT count(*) AS n FROM credentials").get()?.n, 0);
  db.close();
  assert.equal(JSON.parse(await readFile(join(data, "control/manifest.json"), "utf8")).failures, 0);
});

test("self-change cannot request a lease or write protected credentials", () => {
  assert.equal(Command.safeParse({ kind: "lease" }).success, false);
  assert.equal(Command.safeParse({ kind: "refresh", provider: "openai-codex" }).success, false);
});

test("candidate sandbox denies the lease socket and owner credential writes", { skip: process.platform !== "darwin" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "gl-sandbox-"));
  const outside = await mkdtemp(join(tmpdir(), "gl-owner-"));
  const server = (await import("node:net")).createServer().listen(join(outside, "s"));
  await once(server, "listening");
  try {
    await writeFile(join(outside, "oauth.sqlite"), "synthetic-owner-store");
    await mkdir(join(root, ".scratch"));
    const profile = await sandboxProfile(root, resolve("core"), resolve("node_modules"));
    const proof = join(root, "proof.mjs");
    await writeFile(proof, `import {createConnection} from 'node:net'; import {writeFileSync} from 'node:fs'; import assert from 'node:assert/strict'; assert.throws(()=>writeFileSync(${JSON.stringify(join(outside, "oauth.sqlite"))},'bad'), e=>e.code==='EPERM'||e.code==='EACCES'); await new Promise((resolve,reject)=>{const s=createConnection(${JSON.stringify(join(outside, "s"))}); s.on('error',e=>e.code==='EPERM'?resolve():reject(e)); s.on('connect',()=>{s.destroy();reject(Error('socket allowed'));});});`);
    await command("/usr/bin/sandbox-exec", ["-f", profile, process.execPath, proof], root);
    assert.equal(await readFile(join(outside, "oauth.sqlite"), "utf8"), "synthetic-owner-store");
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
