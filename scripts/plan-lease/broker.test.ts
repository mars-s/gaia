import assert from "node:assert/strict";
import { z } from "zod";
import { test, type TestContext } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createConnection } from "node:net";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { broker, Options } from "./broker.ts";
import { leaseStore, LeaseReply, LEASE_UNAVAILABLE } from "../../core/plan-lease.ts";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "gl-broker-"));
  const owner = join(root, "owner"); const data = join(root, "test");
  await mkdir(join(owner, "control"), { recursive: true });
  await mkdir(join(owner, "credentials")); await mkdir(data);
  await writeFile(join(owner, "control/manifest.json"), "{}");
  const db = new DatabaseSync(join(owner, "credentials/oauth.sqlite"));
  db.exec("CREATE TABLE credentials(provider TEXT PRIMARY KEY,value TEXT NOT NULL)");
  for (const provider of ["openai-codex", "anthropic"]) db.prepare("INSERT INTO credentials VALUES (?,?)").run(provider, JSON.stringify({ type: "oauth", access: `synthetic-${provider}`, refresh: "synthetic-private-refresh", expires: Date.now() + 600_000 }));
  db.close();
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, owner, data, options: { ownerData: owner, data, provider: "openai-codex" as const, port: 4347 } };
}
function request(socket: string, value: unknown, raw = false) {
  return new Promise<string>((resolve, reject) => {
    const client = createConnection(socket);
    let result = "";
    client.setTimeout(7000, () => client.destroy(new Error("test deadline")));
    client.on("error", reject);
    client.on("connect", () => client.end(raw ? String(value) : JSON.stringify(value) + "\n"));
    client.on("data", (chunk) => { result += chunk; });
    client.on("end", () => resolve(result));
  });
}

test("broker holds ownership, lends only access, withstands abuse and cleans up", { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  const previous = process.env.GAIA_ATTACK_MARKER;
  process.env.GAIA_ATTACK_MARKER = "synthetic-untrusted-env";
  t.after(() => { if (previous === undefined) delete process.env.GAIA_ATTACK_MARKER; else process.env.GAIA_ATTACK_MARKER = previous; });
  let child: ChildProcess | undefined;
  let env: NodeJS.ProcessEnv = {};
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const logs: string[] = [];
  let refreshes = 0;
  let clock = Date.now();
  const session = broker(f.options, {
    log: (line) => logs.push(line), now: () => clock,
    configure(auth) {
      const real = openaiCodexProvider(); assert(real.auth.oauth);
      auth.models.setProvider({ ...real, auth: { oauth: { ...real.auth.oauth, async refresh(current) { refreshes++; return { ...current, access: "synthetic-refreshed", refresh: "synthetic-rotated", expires: Date.now() + 7200_000 }; } } } });
    },
    launch(_command, _args, options) {
      env = options?.env ?? {};
      child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
      ready(); return child;
    },
  });
  t.after(async () => { child?.kill("SIGTERM"); await session; });
  await started;
  const socket = env.GAIA_PLAN_LEASE_SOCKET!; const key = env.GAIA_PLAN_LEASE_KEY!;
  const good = { key, provider: "openai-codex" };
  assert.equal((await stat(join(socket, ".."))).mode & 0o777, 0o700);
  assert(!socket.startsWith(f.owner) && !socket.startsWith(f.data));
  assert.deepEqual(Object.keys(env).filter((name) => name.startsWith("GAIA_")).sort(), ["GAIA_DATA_DIR", "GAIA_HOST", "GAIA_PORT", "GAIA_PLAN_LEASE_KEY", "GAIA_PLAN_LEASE_PROVIDER", "GAIA_PLAN_LEASE_SOCKET"].sort());
  const responses = await Promise.all(Array.from({ length: 5 }, () => request(socket, good)));
  for (const bytes of responses) {
    const reply = LeaseReply.parse(JSON.parse(bytes)); assert(reply.ok);
    assert(reply.expires <= clock + 900_000);
    assert(!bytes.includes("synthetic-private-refresh") && !bytes.includes("synthetic-anthropic"));
  }
  assert.equal(refreshes, 1);
  await assert.rejects(broker(f.options));
  for (const bad of ["", "x", ...Array.from({ length: 1000 }, () => randomBytes(32).toString("base64url"))]) assert.deepEqual(JSON.parse(await request(socket, { ...good, key: bad })), { ok: false });
  for (const bad of [{ ...good, provider: "anthropic" }, { ...good, refresh: true }, { ...good, path: join(f.owner, "credentials/oauth.sqlite"), write: "bad" }]) assert.deepEqual(JSON.parse(await request(socket, bad)), { ok: false });
  await request(socket, "not-json\n", true);
  await request(socket, "x".repeat(5 * 1024 * 1024), true).catch(() => "");
  const half = createConnection(socket); await once(half, "connect"); half.write("{");
  const flood = await Promise.allSettled(Array.from({ length: 50 }, () => request(socket, good)));
  assert.equal(flood.length, 50);
  assert(LeaseReply.parse(JSON.parse(await request(socket, good))).ok);
  await once(half, "close");
  await writeFile(join(f.data, "planted.txt"), "synthetic-refreshed");
  await mkdir(join(f.data, "dependencies"));
  await writeFile(join(f.data, "dependencies/skipped"), "synthetic-refreshed");
  clock += 5 * 3600_000;
  assert.deepEqual(JSON.parse(await request(socket, good)), { ok: false });
  child!.kill("SIGTERM"); await session;
  await assert.rejects(stat(socket));
  assert.deepEqual(await readdir(join(f.owner, "control")), ["manifest.json"]);
  assert(logs.some((line) => line.includes("planted.txt")));
  assert(!logs.some((line) => line.includes(key) || /synthetic-(refreshed|rotated|private-refresh)/.test(line)));
  const store = leaseStore({ socket, key, provider: "openai-codex" });
  await assert.rejects(store.read("openai-codex"), { message: LEASE_UNAVAILABLE });
  const db = new DatabaseSync(join(f.owner, "credentials/oauth.sqlite"), { readOnly: true });
  assert(String(db.prepare("SELECT value FROM credentials WHERE provider='openai-codex'").get()?.value).includes("synthetic-rotated")); db.close();
});

for (const lock of ["supervisor.lock", "bootstrap.lock", "owner-upgrade.lock"]) test(`broker refuses live ${lock}`, async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.owner, "control", lock), String(process.pid));
  await assert.rejects(broker(f.options));
  assert.equal(await readFile(join(f.owner, "control", lock), "utf8"), String(process.pid));
});

test("broker refuses overlapping paths including symlinks and invalid options", async (t) => {
  const f = await fixture(t);
  const link = join(f.root, "link"); await symlink(f.owner, link);
  for (const data of [f.owner, join(f.owner, "control"), f.root, link, "/"]) await assert.rejects(broker({ ...f.options, data }));
  for (const port of [4317, 8096, 8264, 8090, 1.5, 0, 65536]) assert(!Options.safeParse({ ...f.options, port }).success);
  assert(!Options.safeParse({ ...f.options, hours: 13 }).success);
  assert(!Options.safeParse({ ...f.options, host: "0.0.0.0" }).success);
});

test("broker refuses an unsigned plan and cleans acquired locks", async (t) => {
  const f = await fixture(t);
  const db = new DatabaseSync(join(f.owner, "credentials/oauth.sqlite")); db.exec("DELETE FROM credentials"); db.close();
  await assert.rejects(broker(f.options), { message: "That plan is not signed in on your Gaia." });
  assert.deepEqual(await readdir(join(f.owner, "control")), ["manifest.json"]);
});

for (const ending of ["normal", "crash", "signal", "throw", "refresh-failure"] as const) test(`broker cleans stale ownership and socket after ${ending}`, async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.owner, "control/bootstrap.lock"), "2147483647");
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  let env: NodeJS.ProcessEnv = {};
  let child: ChildProcess | undefined;
  const logs: string[] = [];
  const before = await readFile(join(f.owner, "credentials/oauth.sqlite"));
  const session = broker(f.options, {
    log: (line) => logs.push(line),
    configure(auth) {
      const real = openaiCodexProvider(); assert(real.auth.oauth);
      auth.models.setProvider({ ...real, auth: { oauth: { ...real.auth.oauth, async refresh() { throw new Error("synthetic-secret-endpoint-body"); } } } });
    },
    launch(_command, _args, options) {
      env = options.env ?? {};
      if (ending === "throw") throw new Error("synthetic spawn failure");
      child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
      ready(); return child;
    },
  });
  if (ending === "throw") await assert.rejects(session);
  else {
    t.after(async () => { child?.kill("SIGTERM"); await session; });
    await started;
    if (ending === "refresh-failure") {
      assert.deepEqual(JSON.parse(await request(env.GAIA_PLAN_LEASE_SOCKET!, { key: env.GAIA_PLAN_LEASE_KEY, provider: "openai-codex" })), { ok: false });
      assert((await readFile(join(f.owner, "credentials/oauth.sqlite"))).equals(before));
    }
    if (ending === "signal") process.emit("SIGTERM", "SIGTERM");
    else child!.kill(ending === "crash" ? "SIGKILL" : "SIGTERM");
    await session;
  }
  if (env.GAIA_PLAN_LEASE_SOCKET) await assert.rejects(stat(join(env.GAIA_PLAN_LEASE_SOCKET, "..")));
  assert.deepEqual(await readdir(join(f.owner, "control")), ["manifest.json"]);
  assert(logs.includes("Lease tokens found in test data: none"));
  assert(!logs.some((line) => /synthetic-secret|synthetic-private-refresh/.test(line)));
});

test("broker refuses a still-running managed child even without supervisor locks", async (t) => {
  const f = await fixture(t);
  const marker = `--managed-child=${f.owner}`;
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", "--", marker], { stdio: "ignore" });
  t.after(async () => { child.kill("SIGTERM"); await once(child, "exit"); });
  await writeFile(join(f.owner, "control/child.json"), JSON.stringify({ pid: child.pid, marker }));
  await assert.rejects(broker(f.options), /Stop the managed child/);
});

test("retired fixture refuses before opening any credential store", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", "data/verification/four-profiles/live-fixture.ts"], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stderr.on("data", (chunk) => { output += chunk; });
  const [code] = await once(child, "exit");
  assert.notEqual(code, 0);
  assert.match(output, /This unsafe live fixture is retired/);
});

test("CLI reports a missing sign-in without endpoint diagnostics", async (t) => {
  const f = await fixture(t);
  const db = new DatabaseSync(join(f.owner, "credentials/oauth.sqlite")); db.exec("DELETE FROM credentials"); db.close();
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/plan-lease/cli.ts", "--owner-data", f.owner, "--data", f.data, "--provider", "openai-codex", "--port", "4347"], { stdio: ["ignore", "pipe", "pipe"] });
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk; });
  const [code] = await once(child, "exit");
  assert.equal(code, 1);
  assert.equal(errors, "That plan is not signed in on your Gaia.\n");
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) test(`repeated ${signal} during cleanup preserves an in-flight rotated credential`, { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  const entry = join(f.root, "signals.mts");
  await writeFile(entry, `
import {spawn} from 'node:child_process';
import {broker} from ${JSON.stringify(join(process.cwd(), "scripts/plan-lease/broker.ts"))};
import {openaiCodexProvider} from ${JSON.stringify(join(process.cwd(), "node_modules/@earendil-works/pi-ai/dist/providers/openai-codex.js"))};
let release;
const gate = new Promise(resolve => { release = resolve; });
process.on('message', message => { if(message === 'release') release(); });
process.exitCode = await broker(${JSON.stringify(f.options)}, {
  configure(auth) {
    const real = openaiCodexProvider();
    auth.models.setProvider({...real, auth:{oauth:{...real.auth.oauth,
      async refresh(current) {
        process.send('refreshing');
        await gate;
        return {...current, access:'synthetic-new-access', refresh:'synthetic-saved-rotation', expires:Date.now()+7200000};
      }
    }}});
  },
  launch(command, args, options) {
    const child = spawn(process.execPath, ['-e','setInterval(()=>{},1000)'], {stdio:'ignore'});
    child.once('exit', () => process.send('child-exited'));
    process.send({socket:options.env.GAIA_PLAN_LEASE_SOCKET, key:options.env.GAIA_PLAN_LEASE_KEY});
    return child;
  }
});
process.disconnect();
`);
  const runner = spawn(process.execPath, ["--import", "tsx", entry], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const exited = once(runner, "exit");
  let output = "";
  const events: unknown[] = [];
  runner.on("message", (message) => events.push(message));
  runner.stdout?.on("data", (chunk) => { output += chunk; });
  runner.stderr?.on("data", (chunk) => { output += chunk; });
  t.after(async () => { if (runner.exitCode === null && runner.signalCode === null) { runner.send("release"); runner.kill("SIGTERM"); } await exited; });
  async function until(ready: () => boolean) {
    for (let i = 0; i < 400; i++) { if (ready()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
    assert.fail("Signal fixture did not reach the expected state.");
  }
  await until(() => events.some((event) => typeof event === "object" && event !== null));
  const info = z.object({ socket: z.string(), key: z.string() }).parse(events.find((event) => typeof event === "object" && event !== null));
  const client = createConnection(info.socket);
  client.on("error", () => {});
  client.on("data", () => {});
  await once(client, "connect");
  client.write(JSON.stringify({ key: info.key, provider: "openai-codex" }) + "\n");
  await until(() => events.includes("refreshing"));
  runner.kill(signal);
  await until(() => events.includes("child-exited"));
  runner.kill(signal);
  await until(() => output.includes("Finishing up. Please wait."));
  assert.equal(runner.signalCode, null);
  runner.send("release");
  await exited;
  client.destroy();
  assert.equal(runner.signalCode, null);
  assert(output.includes("Leases granted:"));
  assert(!output.includes(info.key) && !output.includes("synthetic-saved-rotation"));
  const db = new DatabaseSync(join(f.owner, "credentials/oauth.sqlite"), { readOnly: true });
  assert(String(db.prepare("SELECT value FROM credentials WHERE provider='openai-codex'").get()?.value).includes("synthetic-saved-rotation"));
  db.close();
  assert.deepEqual(await readdir(join(f.owner, "control")), ["manifest.json"]);
});
