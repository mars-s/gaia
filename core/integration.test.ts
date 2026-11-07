import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Change, State, atomic, readState } from "./state.ts";
import { installCore, importBaseline } from "./install.ts";
import { control } from "./control-client.ts";
import { freePort, waitHealth } from "./sandbox.ts";
import { stop } from "./process.ts";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { createAuth } from "./auth.ts";
import { createPi } from "../apps/server/pi.ts";
import { selfChangeTools } from "./tools.ts";
const source = resolve(".");
const dependencies = join(source, "node_modules");
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeout = 90000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await delay(30);
  }
  throw new Error("Integration deadline exceeded");
}
test(
  "managed app source changes, exact reverts, failed gates, recovery, safe mode and credential preservation",
  { timeout: 600000, skip: process.platform !== "darwin" },
  async (t) => {
    const root = await mkdtemp(
      join(
        process.platform === "darwin" ? "/private/tmp" : tmpdir(),
        "gaia-managed-",
      ),
    );
    const data = join(root, "data");
    const core = join(root, "protected");
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    let processOwner: ChildProcess | undefined;
    let logs = "";
    const socket = join(data, "control/supervisor.sock");
    const history = async () =>
      z
        .object({ changes: z.array(Change) })
        .parse(await control(socket, { kind: "history" })).changes;
    const start = async () => {
      processOwner = spawn(
        process.execPath,
        [
          "--import",
          join(dependencies, "tsx/dist/loader.mjs"),
          join(root, "runner.mts"),
        ],
        {
          cwd: source,
          detached: true,
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        },
      );
      for (const pipe of [processOwner.stdout, processOwner.stderr])
        pipe?.on("data", (chunk) => {
          logs = (logs + chunk).slice(-20000);
        });
      const ready = await Promise.race([
        once(processOwner, "message"),
        once(processOwner, "exit").then(() => {
          throw new Error(logs);
        }),
      ]);
      assert.equal(ready[0], "ready");
      await waitHealth(base, (await readState(data)).active.release);
    };
    const finish = async (id: string) => {
      const entries = await until(history, (entries) =>
        entries.some(
          (entry) =>
            entry.id === id &&
            !["queued", "checking", "staged"].includes(entry.outcome),
        ),
      );
      await until(
        async () =>
          z
            .object({ busy: z.boolean() })
            .parse(await control(socket, { kind: "status" })).busy,
        (busy) => !busy,
      );
      const entry = entries.find((entry) => entry.id === id);
      assert(entry);
      return entry;
    };
    const stage = async (text: string, path = "apps/server/server.ts") =>
      Change.parse(
        await control(socket, {
          kind: "stage",
          reason: "Integration source change 🌱",
          edits: [{ path, text }],
        }),
      );
    const submit = async (entry: Change) => {
      if (entry.diff.includes("diff --git a/apps/web/"))
        await control(socket, { kind: "preview", id: entry.id, surfaces: [] });
      await control(socket, { kind: "submit", id: entry.id });
      return finish(entry.id);
    };
    const reset = async () => {
      if (processOwner) await stop(processOwner);
      const state = await readState(data);
      await atomic(join(data, "control/manifest.json"), {
        kind: "stable",
        active: stable,
        good: state.good,
        failures: 0,
      });
      await start();
    };
    let stable: State["active"];
    try {
      for (const name of [
        "control",
        "credentials",
        "releases",
        "staging",
        "generations",
        "snapshots",
        "home",
      ])
        await mkdir(join(data, name), { recursive: true });
      const legacy = new DatabaseSync(join(data, "gaia.sqlite"));
      legacy.exec(
        "CREATE TABLE credentials (provider TEXT PRIMARY KEY, value TEXT NOT NULL)",
      );
      legacy
        .prepare("INSERT INTO credentials VALUES (?,?)")
        .run("migration-fixture", "legacy-credential-sentinel");
      legacy.close();
      await installCore(source, core, dependencies);
      await importBaseline(source, data, core, dependencies);
      stable = (await readState(data)).active;
      const importedCredentials = new DatabaseSync(
        join(data, "credentials/oauth.sqlite"),
        { readOnly: true },
      );
      assert.equal(
        importedCredentials
          .prepare("SELECT value FROM credentials WHERE provider=?")
          .get("migration-fixture")?.value,
        "legacy-credential-sentinel",
      );
      importedCredentials.close();
      const importedConversation = new DatabaseSync(
        join(data, "generations", stable.generation, "gaia.sqlite"),
        { readOnly: true },
      );
      assert.equal(
        importedConversation
          .prepare("SELECT name FROM sqlite_master WHERE name='credentials'")
          .get(),
        undefined,
      );
      importedConversation.close();

      await writeFile(
        join(root, "runner.mts"),
        `import {Supervisor} from ${JSON.stringify(join(core, "core/supervisor.ts"))}; const supervisor=new Supervisor(${JSON.stringify({ data, core, dependencies, host: "127.0.0.1", port, testProvider: true, probeTimeout: 3000, bootTimeout: 2000 })}); await supervisor.open(); process.send?.('ready'); process.on('SIGTERM',()=>{void supervisor.close().then(()=>process.exit(0));});`,
      );
      await start();
      const original = await readFile(
        join(data, "releases", stable.release, "apps/server/server.ts"),
        "utf8",
      );
      const request = (path: string, body: unknown) =>
        fetch(base + path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      await request("/api/v1/messages", {
        text: "Keep this user message 🌱",
        requestId: randomUUID(),
      });
      await until(
        async () =>
          (await (await fetch(base + "/api/v1/state")).json()).thread.run.kind,
        (kind) => kind === "idle",
      );
      await t.test(
        "real source promotion and new file revert preserve exact original bytes and messages",
        async () => {
          const oldHtml = await (await fetch(base + "/")).text();
          const oldCssPath = /href="([^"]+\.css)"/.exec(oldHtml)?.[1];
          assert(oldCssPath);
          const oldCss = await (await fetch(base + oldCssPath)).text();
          const modified = original.replace(
            "return json(200, snapshot());",
            'return json(200, { ...snapshot(), marker: "source-promoted" });',
          );
          const entry = Change.parse(
            await control(socket, {
              kind: "stage",
              reason: "Add actual server marker and new module",
              edits: [
                { path: "apps/server/server.ts", text: modified },
                {
                  path: "apps/server/new-module.ts",
                  text: 'export const marker = "🌱";\n\n',
                },
                {
                  path: "apps/web/style.css",
                  text:
                    (await readFile(
                      join(source, "apps/web/style.css"),
                      "utf8",
                    )) + "\n:root { --gaia-test-release: 1; }\n",
                },
              ],
            }),
          );
          const promotion = await submit(entry);
          assert.equal(promotion.outcome, "accepted", promotion.detail);
          assert(
            promotion.checks.includes(
              "rendered design checks: passed (matching trusted preview)",
            ),
          );
          assert.deepEqual(
            (
              await readdir(join(data, "releases", promotion.commit!, "dist"))
            ).filter((name) => name.startsWith(".render-")),
            [],
          );
          const shot = promotion.previews?.shots[0];
          assert(shot);
          const image = await fetch(
            `${base}/api/v1/selfmod/images/${promotion.id}/${shot.after}`,
          );
          assert.equal(image.status, 200);
          assert.equal(image.headers.get("content-type"), "image/jpeg");
          assert((await image.arrayBuffer()).byteLength > 1000);
          assert.equal(
            (
              await fetch(
                `${base}/api/v1/selfmod/images/${promotion.id}/${shot.after}`,
                { headers: { "sec-fetch-site": "cross-site" } },
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await fetch(
                `${base}/api/v1/selfmod/images/${promotion.id}/after-missing.jpg`,
              )
            ).status,
            400,
          );
          const newHtml = await (await fetch(base + "/")).text();
          const newCssPath = /href="([^"]+\.css)"/.exec(newHtml)?.[1];
          assert(newCssPath);
          assert.notEqual(newCssPath, oldCssPath);
          assert.match(
            newHtml,
            new RegExp(`/_gaia/releases/${promotion.commit}/assets/`),
          );
          assert.match(
            await (await fetch(base + newCssPath)).text(),
            /--gaia-test-release:\s*1/,
          );
          const retained = await fetch(base + oldCssPath);
          assert.equal(retained.headers.get("content-type"), "text/css");
          assert.equal(await retained.text(), oldCss);
          assert.equal(
            (await (await fetch(base + "/api/v1/state")).json()).marker,
            "source-promoted",
          );
          assert(
            (
              await (await fetch(base + "/api/v1/state")).json()
            ).thread.messages.some(
              (message: { text: string }) =>
                message.text === "Keep this user message 🌱",
            ),
          );
          const reverted = Change.parse(
            await control(socket, { kind: "revert", id: promotion.id }),
          );
          const result = await finish(reverted.id);
          assert.equal(result.outcome, "accepted", result.detail);
          assert.equal(
            result.previews?.shots.length,
            20,
            "Revert retains its own before and after shots",
          );
          const state = await readState(data);
          stable = state.active;
          assert.equal(
            await readFile(
              join(data, "releases", stable.release, "apps/server/server.ts"),
              "utf8",
            ),
            original,
          );
          await assert.rejects(
            readFile(
              join(
                data,
                "releases",
                stable.release,
                "apps/server/new-module.ts",
              ),
            ),
            /ENOENT/,
          );
          assert(
            (
              await (await fetch(base + "/api/v1/state")).json()
            ).thread.messages.some(
              (message: { text: string }) =>
                message.text === "Keep this user message 🌱",
            ),
          );
        },
      );
      await t.test(
        "source JSON survives split UTF-8 through the public and control HTTP parsers",
        async () => {
          const { createConnection } = await import("node:net");
          const payload = Buffer.from(
            JSON.stringify({
              reason: "Unicode source 🌱",
              edits: [
                {
                  path: "apps/server/unicode.ts",
                  text: 'export const unicode = "🌱 café";\n',
                },
              ],
            }),
          );
          const split = payload.lastIndexOf(Buffer.from("🌱")) + 2;
          const client = createConnection({ host: "127.0.0.1", port });
          await once(client, "connect");
          const chunks: Buffer[] = [];
          client.on("data", (chunk) => chunks.push(chunk));
          const ended = once(client, "end");
          client.write(
            `POST /api/v1/selfmod/stage HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nContent-Length: ${payload.length}\r\nConnection: close\r\n\r\n`,
          );
          client.write(payload.subarray(0, split));
          await delay(15);
          client.write(payload.subarray(split));
          await ended;
          assert.match(Buffer.concat(chunks).toString(), /202/);
          const entry = (await history()).at(-1);
          assert(entry);
          assert.equal(
            await readFile(
              join(data, "staging", entry.id, "apps/server/unicode.ts"),
              "utf8",
            ),
            'export const unicode = "🌱 café";\n',
          );
          assert(!entry.diff.includes("�"));
        },
      );
      await t.test(
        "Pi Durable model tool stages actual source through supervisor control",
        async () => {
          const db = new DatabaseSync(join(root, "tool-auth.sqlite"));
          const auth = createAuth(db);
          const faux = fauxProvider({
            provider: "openai-codex",
            models: [{ id: "gpt-6.1-sol" }],
            tokensPerSecond: 100000,
          });
          auth.models.setProvider(faux.provider);
          auth.planAvailability.connectedProviders = () =>
            new Set(["openai-codex"]);
          const reason = "Model-authored source fixture";
          faux.setResponses([
            (context) => {
              assert(
                context.messages.some(
                  (message) =>
                    message.role === "system" &&
                    message.toolsAdded?.some(
                      (tool) => tool.name === "self_change",
                    ),
                ),
              );
              return fauxAssistantMessage(
                fauxToolCall("self_change", {
                  command: JSON.stringify({
                    kind: "stage",
                    reason,
                    edits: [
                      {
                        path: "apps/server/model-authored.ts",
                        text: 'export const modelAuthored = "actual source";\n',
                      },
                    ],
                  }),
                }),
                { stopReason: "toolUse" },
              );
            },
            (context) => {
              assert(
                JSON.stringify(context.messages).includes(
                  "Source staged in an isolated worktree",
                ),
              );
              return fauxAssistantMessage(
                "Source staged. Submit would queue trusted verification.",
              );
            },
          ]);
          const pi = await createPi(join(root, "tool-pi.sqlite"), auth, [
            selfChangeTools(socket),
          ]);
          try {
            let output = "";
            await pi.run({
              text: "Make a source change with the supported tool.",
              requestId: randomUUID(),
              onText: (text) => {
                output = text;
              },
              signal: new AbortController().signal,
            });
            assert.match(output, /Source staged/);
            const change = (await history()).find(
              (entry) => entry.reason === reason,
            );
            assert(change);
            assert.equal(
              await readFile(
                join(
                  data,
                  "staging",
                  change.id,
                  "apps/server/model-authored.ts",
                ),
                "utf8",
              ),
              'export const modelAuthored = "actual source";\n',
            );
          } finally {
            await pi.close();
            await auth.close();
            db.close();
          }
        },
      );
      await t.test(
        "durable stable receipt repairs history after an interrupted metadata write",
        async () => {
          assert(processOwner);
          await stop(processOwner);
          const state = await readState(data);
          assert(state.receipt);
          const entries = z
            .array(Change)
            .parse(
              JSON.parse(
                await readFile(join(data, "control/history.json"), "utf8"),
              ),
            );
          const completed = entries.find(
            (entry) => entry.id === state.receipt?.id,
          );
          assert(completed);
          completed.outcome = "checking";
          completed.commit = null;
          await atomic(join(data, "control/history.json"), entries);
          await start();
          const repaired = (await history()).find(
            (entry) => entry.id === completed.id,
          );
          assert(repaired);
          assert.equal(repaired.outcome, state.receipt.outcome);
          assert.equal(repaired.commit, state.active.release);
        },
      );
      const cases = [
        {
          name: "typecheck",
          text: original + '\nconst typeError: number = "wrong";\n',
          check: "typecheck: failed",
        },
        {
          name: "lint",
          text: original + "\nconst unused = 1;\n",
          check: "lint: failed",
        },
        {
          name: "unit tests",
          text: original.replace(
            "const now = new Date().toISOString();",
            'if (text === "hello") throw new Error("unit fixture"); const now = new Date().toISOString();',
          ),
          check: "unit tests: failed",
        },
        {
          name: "sandbox boot",
          text:
            'if (process.argv.includes("--sandbox-probe")) throw new Error("boot fixture");\n' +
            original,
          check: "sandbox",
        },
        {
          name: "public health",
          text:
            'if (process.argv.includes("--test-provider")) throw new Error("health fixture");\n' +
            original,
          check: "Health probe",
        },
        {
          name: "public chat",
          text: original
            .replace(
              "adapter.run({",
              '(process.argv.includes("--test-provider") ? Promise.reject(new Error("chat fixture")) : adapter.run({',
            )
            .replace(
              "signal: controller.signal,\n        }),",
              "signal: controller.signal,\n        })), ",
            ),
          check: "Scripted chat",
        },
        {
          name: "schema compatibility",
          text: original.replace(
            "  db.exec(",
            '  if (process.argv.includes("--test-provider")) db.exec("CREATE TABLE IF NOT EXISTS unsupported_schema (id TEXT)");\n  db.exec(',
          ),
          check: "Schema version",
        },
        {
          name: "reconnect",
          text: original
            .replace(
              "const send = (data: Snapshot) =>",
              "const send = (data: Snapshot) =>",
            )
            .replace(
              'res.write(`data: ${JSON.stringify({ type: "snapshot", data })}\\n\\n`);',
              'res.write(`data: ${JSON.stringify({ type: "snapshot", data: process.argv.includes("--test-provider") ? { ...data, runtime: { release: "wrong", mode: "probing", selfModification: false } } : data })}\\n\\n`);',
            ),
          check: "Reconnect",
        },
      ];
      for (const fixture of cases)
        await t.test(
          `rejects ${fixture.name} failure and preserves user data`,
          async () => {
            await reset();
            // Refresh credentials after the snapshot boundary. Rollback must retain this separate store.
            const credentials = new DatabaseSync(
              join(data, "credentials/oauth.sqlite"),
            );
            credentials
              .prepare("INSERT OR REPLACE INTO credentials VALUES (?,?)")
              .run("test-refresh", "new-refresh-sentinel");
            credentials.close();
            const entry = await stage(fixture.text);
            const result = await submit(entry);
            assert(
              ["rejected", "rolled-back"].includes(result.outcome),
              result.detail,
            );
            if (fixture.check)
              assert.match(
                result.detail + result.checks.join("\n"),
                new RegExp(fixture.check, "i"),
              );
            assert.equal(
              (await readState(data)).active.release,
              stable.release,
            );
            assert(
              (
                await (await fetch(base + "/api/v1/state")).json()
              ).thread.messages.some(
                (message: { text: string }) =>
                  message.text === "Keep this user message 🌱",
              ),
            );
            const after = new DatabaseSync(
              join(data, "credentials/oauth.sqlite"),
              { readOnly: true },
            );
            assert.equal(
              after
                .prepare("SELECT value FROM credentials WHERE provider=?")
                .get("test-refresh")?.value,
              "new-refresh-sentinel",
            );
            after.close();
          },
        );
      await t.test(
        "serialises promotions and persists rollback recovery from probing on supervisor death",
        async () => {
          await reset();
          const slow = original
            .replace(
              "adapter.run({",
              '(process.argv.includes("--test-provider") ? new Promise<void>(() => {}) : adapter.run({',
            )
            .replace(
              "signal: controller.signal,\n        }),",
              "signal: controller.signal,\n        })), ",
            );
          const entry = await stage(slow);
          await control(socket, { kind: "submit", id: entry.id });
          await assert.rejects(
            control(socket, {
              kind: "stage",
              reason: "overlap",
              edits: [{ path: "apps/server/overlap.ts", text: "export {};" }],
            }),
            /progress/,
          );
          await until(
            () => readState(data),
            (value) => value.kind === "probing",
          );
          const refreshed = new DatabaseSync(
            join(data, "credentials/oauth.sqlite"),
          );
          refreshed
            .prepare("INSERT OR REPLACE INTO credentials VALUES (?,?)")
            .run("post-snapshot-refresh", "newest-refresh-sentinel");
          refreshed.close();
          await waitHealth(base, (await readState(data)).active.release);
          assert.equal(
            (
              await request("/api/v1/messages", {
                requestId: randomUUID(),
                text: "must not persist",
              })
            ).status,
            503,
          );
          assert(processOwner?.pid);
          process.kill(processOwner.pid, "SIGKILL");
          await once(processOwner, "exit");
          await start();
          assert.equal((await readState(data)).active.release, stable.release);
          assert.equal(
            (await history()).find((change) => change.id === entry.id)?.outcome,
            "interrupted",
          );
          const retained = new DatabaseSync(
            join(data, "credentials/oauth.sqlite"),
            { readOnly: true },
          );
          assert.equal(
            retained
              .prepare("SELECT value FROM credentials WHERE provider=?")
              .get("post-snapshot-refresh")?.value,
            "newest-refresh-sentinel",
          );
          retained.close();
          assert(
            !(
              await (await fetch(base + "/api/v1/state")).json()
            ).thread.messages.some(
              (message: { text: string }) =>
                message.text === "must not persist",
            ),
          );
        },
      );
      for (const phase of ["check", "boot"]) {
        await t.test(
          `SIGKILL during a real hanging sandbox ${phase} cleans descendants and recovers checking`,
          async () => {
            await reset();
            const marker =
              phase === "boot"
                ? ".probe-data/hanging.json"
                : ".scratch/hanging.json";
            const condition =
              phase === "boot"
                ? 'process.argv.includes("--sandbox-probe")'
                : "process.env.NODE_TEST_CONTEXT";
            const prefix = `import {spawn as hangingSpawn} from 'node:child_process';
import {writeFileSync as hangingWrite} from 'node:fs';
if (${condition}) {
  const children = [1, 2].map(() => hangingSpawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore'}));
  hangingWrite(${JSON.stringify(marker)}, JSON.stringify([process.pid, ...children.map(child=>child.pid)]));
  await new Promise(()=>{});
}
`;
            const entry = await stage(prefix + original);
            await control(socket, { kind: "submit", id: entry.id });
            const path = join(data, "staging", entry.id, marker);
            const pids: number[] = await until(
              async () => {
                try {
                  return JSON.parse(await readFile(path, "utf8"));
                } catch {
                  return [];
                }
              },
              (value) => value.length === 3,
            );
            assert.equal((await readState(data)).kind, "checking");
            assert(processOwner?.pid);
            process.kill(processOwner.pid, "SIGKILL");
            await once(processOwner, "exit");
            await until(
              async () =>
                pids.every((pid) => {
                  try {
                    return execFileSync(
                      "/bin/ps",
                      ["-p", String(pid), "-o", "stat="],
                      { stdio: ["ignore", "pipe", "ignore"] },
                    )
                      .toString()
                      .trim()
                      .startsWith("Z");
                  } catch {
                    return true;
                  }
                }),
              (value) => value,
              10000,
            );
            await start();
            const recovered = await readState(data);
            assert.deepEqual(recovered.active, stable);
            assert.equal(recovered.failures, 1);
            assert.equal(
              (await history()).find((item) => item.id === entry.id)?.outcome,
              "interrupted",
            );
          },
        );
      }
      await t.test(
        "restart failure pins safe code and retains the latest compatible conversation",
        async () => {
          await reset();
          const prefix = `import {readFileSync as bootRead, writeFileSync as bootWrite, appendFileSync as bootAppend} from 'node:fs';
if (process.argv.includes('--test-provider')) {
  const marker = process.env.GAIA_GENERATION + '/restart-count';
  let count = 0;
  try { count = Number(bootRead(marker, 'utf8')); } catch { /* First boot. */ }
  bootWrite(marker, String(count + 1));
  bootAppend(process.env.GAIA_GENERATION + '/restart-pids', process.pid + '\\n');
  if (count > 0) await new Promise(()=>{});
}
`;
          const accepted = await submit(await stage(prefix + original));
          assert.equal(accepted.outcome, "accepted", accepted.detail);
          const promoted = await readState(data);
          assert.equal(promoted.failures, 0);
          assert.notEqual(promoted.active.release, promoted.good.release);
          await fetch(base + "/api/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requestId: randomUUID(),
              text: "Keep the conversation written after promotion.",
            }),
          });
          const beforeRestart = await until(
            async () => (await fetch(base + "/api/v1/state")).json(),
            (value) => value.thread.run.kind === "idle",
          );
          assert(
            beforeRestart.thread.messages.some(
              (message: { text: string }) =>
                message.text ===
                "Keep the conversation written after promotion.",
            ),
          );
          assert(processOwner);
          await stop(processOwner);
          await start();
          const recovered = await readState(data);
          assert.equal(recovered.kind, "safe");
          assert.equal(recovered.failures, 3);
          assert.equal(recovered.active.release, recovered.good.release);
          assert.equal(recovered.active.generation, promoted.active.generation);
          assert.deepEqual(
            (await (await fetch(base + "/api/v1/state")).json()).thread
              .messages,
            beforeRestart.thread.messages,
          );
          assert.equal(
            await readFile(
              join(
                data,
                "generations",
                promoted.active.generation,
                "restart-count",
              ),
              "utf8",
            ),
            "4",
          );
          assert.equal(
            (await (await fetch(base + "/healthz")).json()).mode,
            "safe",
          );
          await assert.rejects(stage(original), /safe mode/);
          const failedPids = (
            await readFile(
              join(
                data,
                "generations",
                promoted.active.generation,
                "restart-pids",
              ),
              "utf8",
            )
          )
            .trim()
            .split("\n")
            .map(Number);
          assert.equal(failedPids.length, 4);
          for (const pid of failedPids)
            assert.throws(() => process.kill(pid, 0));
          await stop(processOwner);
          await start();
          assert.equal((await readState(data)).failures, 3);
        },
      );
      await t.test(
        "checking and switching journal states restore the previous pair on restart",
        async () => {
          for (const phase of ["checking", "switching"] as const) {
            await reset();
            const entry = await stage(
              original + "\nexport const recoveryFixture = true;\n",
            );
            assert(processOwner?.pid);
            process.kill(processOwner.pid, "SIGKILL");
            await once(processOwner, "exit");
            const prior = await readState(data);
            const common = {
              active: stable,
              good: prior.good,
              failures: 0,
              change: entry.id,
            };
            await atomic(
              join(data, "control/manifest.json"),
              phase === "checking"
                ? { ...common, kind: phase }
                : {
                    ...common,
                    kind: phase,
                    previous: stable,
                    candidate: { ...stable, generation: randomUUID() },
                  },
            );
            await start();
            assert.equal(
              (await readState(data)).active.release,
              stable.release,
            );
            assert.equal(
              (await history()).find((item) => item.id === entry.id)?.outcome,
              "interrupted",
            );
          }
        },
      );
      await t.test(
        "three failed promotions enter pinned safe mode and disable source tools",
        async () => {
          await reset();
          for (let i = 0; i < 3; i++) {
            const result = await submit(
              await stage(original + '\nconst broken: number = "no";'),
            );
            assert.equal(result.outcome, "rejected");
          }
          const state = await readState(data);
          assert.equal(state.kind, "safe");
          assert.equal(state.active.release, state.good.release);
          await assert.rejects(stage(original), /safe mode/);
          assert.equal(
            (await (await fetch(base + "/healthz")).json()).mode,
            "safe",
          );
        },
      );
      await t.test(
        "three actual child crashes trigger pinned safe chat",
        async () => {
          await reset();
          for (let i = 0; i < 3; i++) {
            const saved = JSON.parse(
              await readFile(join(data, "control/child.json"), "utf8"),
            );
            process.kill(saved.pid, "SIGKILL");
            await until(
              async () => {
                try {
                  return JSON.parse(
                    await readFile(join(data, "control/child.json"), "utf8"),
                  ).pid;
                } catch {
                  return saved.pid;
                }
              },
              (pid) => pid !== saved.pid,
            );
            await delay(500);
          }
          const safe = await until(
            () => readState(data),
            (value) => value.kind === "safe",
          );
          await waitHealth(base, safe.active.release);
          assert.equal(
            (await (await fetch(base + "/healthz")).json()).mode,
            "safe",
          );
        },
      );
      await t.test(
        "broken active and safe baseline fail closed after four counted boots without a leaked child",
        async () => {
          await reset();
          assert(processOwner);
          await stop(processOwner);
          const state = await readState(data);
          for (const release of new Set([
            state.active.release,
            state.good.release,
          ])) {
            const path = join(
              data,
              "releases",
              release,
              "apps/server/server.ts",
            );
            await writeFile(
              path,
              `import {appendFileSync} from 'node:fs'; appendFileSync(process.env.GAIA_GENERATION + '/failed-pids', process.pid + '\\n'); throw Error('broken baseline');\n` +
                (await readFile(path, "utf8")),
            );
          }
          await assert.rejects(start(), /Health probe deadline exceeded/);
          const failed = await readState(data);
          assert.equal(failed.kind, "safe");
          assert.equal(failed.failures, 4);
          assert.equal(failed.active.release, failed.good.release);
          assert.equal(failed.active.generation, state.active.generation);
          await assert.rejects(
            readFile(join(data, "control/child.json")),
            /ENOENT/,
          );
          for (const generation of [state.active.generation]) {
            const pids = (
              await readFile(
                join(data, "generations", generation, "failed-pids"),
                "utf8",
              )
            )
              .trim()
              .split("\n")
              .map(Number);
            for (const pid of pids) assert.throws(() => process.kill(pid, 0));
          }
        },
      );
    } catch (error) {
      process.stderr.write(logs);
      throw error;
    } finally {
      if (processOwner) await stop(processOwner);
      await rm(root, { recursive: true, force: true });
    }
  },
);
