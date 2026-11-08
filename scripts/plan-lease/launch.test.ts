import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { installCore, hashes } from "../../core/install.ts";
import { atomic } from "../../core/state.ts";
import { freePort } from "../../core/sandbox.ts";
import { broker } from "./broker.ts";

const source = fileURLToPath(new URL("../../", import.meta.url));
for (const leased of [true, false]) test(`real broker, bootstrap, main, supervisor and child keep lease opt-in ${leased}`, { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(process.platform === "darwin" ? "/private/tmp" : tmpdir(), "gl-launch-"));
  const previousCwd = process.cwd();
  const owner = join(root, "owner");
  const data = join(root, "test");
  const installed = join(data, "protected/test");
  const release = "a".repeat(40);
  const generation = randomUUID();
  const releaseDir = join(data, "releases", release);
  let child: ChildProcess | undefined;
  let session: Promise<number> | undefined;
  let output = "";
  let log = "";
  try {
    for (const dir of [join(owner, "control"), join(owner, "credentials"), join(data, "control"), join(data, "dependencies"), join(data, "generations", generation), join(releaseDir, "apps/server")]) await mkdir(dir, { recursive: true });
    await writeFile(join(owner, "control/manifest.json"), "{}");
    const db = new DatabaseSync(join(owner, "credentials/oauth.sqlite"));
    db.exec("CREATE TABLE credentials(provider TEXT PRIMARY KEY,value TEXT NOT NULL)");
    db.prepare("INSERT INTO credentials VALUES (?,?)").run("openai-codex", JSON.stringify({ type: "oauth", access: "synthetic-" + randomUUID(), refresh: "synthetic-refresh", expires: Date.now() + 7200000 }));
    db.close();
    await symlink(join(source, "node_modules"), join(data, "dependencies/node_modules"));
    await installCore(source, installed, join(source, "node_modules"));
    const supervisorFile = join(installed, "core/supervisor.ts");
    await writeFile(supervisorFile, (await readFile(supervisorFile, "utf8")).replace("  async open() {", '  async open() {\n    await writeFile(join(this.options.data, "supervisor-env.json"), JSON.stringify({hasKey: Object.hasOwn(process.env, "GAIA_PLAN_LEASE_KEY")}));'));
    await atomic(join(installed, "integrity.json"), await hashes(installed));
    await atomic(join(data, "control/core.json"), installed);
    const pair = { release, generation, schema: 1 };
    await atomic(join(data, "control/manifest.json"), { kind: "stable", active: pair, good: pair, failures: 0 });
    await atomic(join(data, "control/history.json"), []);
    await atomic(join(data, "control/protected.json"), {});
    await writeFile(join(releaseDir, "package.json"), '{"type":"module"}');
    await writeFile(join(releaseDir, "apps/server/server.ts"), `export {createChatServer,openDatabase} from ${JSON.stringify(join(source, "apps/server/server.ts"))};`);
    await writeFile(join(releaseDir, "apps/server/pi.ts"), `import {createPi as real} from ${JSON.stringify(join(source, "apps/server/pi.ts"))}; export async function createPi(...args) { await args[1].models.getAuth('openai-codex'); return real(...args); }`);
    const port = await freePort();
    process.chdir(root);
    session = broker({ ownerData: owner, data, provider: "openai-codex", port }, {
      log: (line) => { log += line + "\n"; },
      configure(auth) {
        const provider = openaiCodexProvider(); assert(provider.auth.oauth);
        auth.models.setProvider({ ...provider, auth: { oauth: { ...provider.auth.oauth, async refresh() { throw new Error("Synthetic token should not need refresh"); } } } });
      },
      launch(command, args, options) {
        assert.equal(args.at(-2), join(source, "core/main.ts"));
        assert.equal(args.at(-1), "--plan-lease");
        child = spawn(command, leased ? args : args.filter((arg) => arg !== "--plan-lease"), { ...options, stdio: ["ignore", "pipe", "pipe"] });
        child.stdout?.on("data", (chunk) => { output += chunk; });
        child.stderr?.on("data", (chunk) => { output += chunk; });
        return child;
      },
    });
    let failure: unknown;
    void session.catch((error: unknown) => { failure = error; });
    let health;
    for (let attempt = 0; attempt < 800; attempt++) {
      if (failure) throw failure;
      try { health = await (await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(500) })).json(); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 25)); }
    }
    assert(health, output);
    for (let attempt = 0; attempt < 400 && !output.includes("Gaia managed"); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert(output.includes("Gaia managed"), output);
    assert.equal(health.mode, "stable");
    assert.equal(health.planLease, leased ? true : undefined);
    assert.deepEqual(JSON.parse(await readFile(join(data, "supervisor-env.json"), "utf8")), { hasKey: !leased });
    const bootPid = Number(await readFile(join(data, "control/bootstrap.lock"), "utf8"));
    const supervisorPid = Number(await readFile(join(data, "control/supervisor.lock"), "utf8"));
    const managed = JSON.parse(await readFile(join(data, "control/child.json"), "utf8"));
    assert.equal(bootPid, child?.pid);
    assert.notEqual(supervisorPid, bootPid);
    assert.notEqual(managed.pid, supervisorPid);
    child?.kill("SIGTERM");
    assert.equal(await session, 0, output);
    const credentials = new DatabaseSync(join(data, "credentials/oauth.sqlite"), { readOnly: true });
    assert.equal(credentials.prepare("SELECT count(*) AS n FROM credentials").get()?.n, 0);
    credentials.close();
    assert(log.includes("Lease tokens found in test data: none"));
    assert.match(log, leased ? /Leases granted: [1-9]/ : /Leases granted: 0/);
    assert.deepEqual(await readdir(join(owner, "control")), ["manifest.json"]);
  } finally {
    try {
      child?.kill("SIGTERM");
      if (session) await session;
    } finally {
      process.chdir(previousCwd);
      await rm(root, { recursive: true, force: true });
    }
  }
});
