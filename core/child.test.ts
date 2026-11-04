import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { z } from "zod";
import { Snapshot } from "../packages/protocol/index.ts";
import { AreaSnapshot } from "../packages/sdk/areas.ts";
import {
  WorkspaceProposal,
  WorkspaceState,
  type WorkspaceRequest,
} from "../packages/sdk/workspace.ts";
import { installCore } from "./install.ts";
import { cleanEnv } from "./process.ts";
import { freePort } from "./sandbox.ts";
import { atomic } from "./state.ts";

const source = resolve(".");
const dependencies = join(source, "node_modules");
const answer = "Genuine installed-child faux Pi result.";
const plan: WorkspaceRequest = {
  plan: {
    kind: "multi",
    areas: [
      { label: "Garden", purpose: "Synthetic garden purpose" },
      { label: "Study", purpose: "Synthetic study purpose" },
    ],
  },
  sharedPreferences: ["Use Australian English"],
};
const Stats = z.object({
  callCount: z.number(),
  deferredFetchCount: z.number(),
  cancelledDeferred: z.array(z.unknown()),
  contexts: z.array(
    z
      .object({
        messages: z.array(z.unknown()),
        tools: z.array(z.string()),
      })
      .passthrough(),
  ),
  aborted: z.number(),
  networkAttempts: z.array(z.string()),
});
type Mode = "stable" | "safe";
async function within<T>(work: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await delay(20);
  }
  throw new Error("Installed-child fixture deadline exceeded.");
}
function vacuum(from: string, to: string) {
  const db = new DatabaseSync(from, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${to.replaceAll("'", "''")}'`);
  } finally {
    db.close();
  }
}
async function inspect(path: string) {
  const harness = await Harness.open(
    await openNodeSqliteStorage(path),
    { models: createModels(), registry: createRegistry() },
    ctx,
  );
  try {
    const inspection = await harness.inspect(ctx);
    assert.equal(inspection.scheduling, "paused");
    const home = await harness.root(ctx);
    const pending = inspection.submissions[0];
    if (!pending) return { inspection, pending: undefined };
    const area = await harness.conversation(pending.conversationId, ctx);
    assert(area);
    assert.notEqual(area.id, home.id);
    const view = await harness.observeConversation(
      area.id,
      { advance() {}, end() {} },
      ctx,
    );
    assert.equal(view.value.conversation.owner, undefined);
    view.detach();
    const context = await area.context(ctx);
    return { inspection, pending, context };
  } finally {
    await harness.close(ctx);
  }
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "gaia-installed-child-"));
  const core = join(root, "protected");
  const release = join(root, "release");
  const data = join(root, "data");
  const credentials = join(root, "credentials.sqlite");
  const children: { stop(): Promise<void> }[] = [];
  t.after(async () => {
    const results = await Promise.allSettled(
      children.map((child) => child.stop()),
    );
    await rm(root, { recursive: true, force: true });
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        "Child fixture cleanup failed.",
      );
  });
  await installCore(source, core, dependencies);
  await mkdir(join(release, "apps/server"), { recursive: true });
  await mkdir(join(root, "home"));
  await writeFile(join(release, "package.json"), '{"type":"module"}');
  await writeFile(
    join(release, "apps/server/server.ts"),
    `export {createChatServer, openDatabase} from ${JSON.stringify(join(source, "apps/server/server.ts"))};`,
  );
  await writeFile(
    join(release, "apps/server/pi.ts"),
    `export {createPi} from ${JSON.stringify(join(source, "core/testing/child-release.ts"))};`,
  );
  const credential = JSON.stringify({
    type: "oauth",
    access: "synthetic-not-an-access-token",
    refresh: "synthetic-not-a-refresh-token",
    expires: Date.now() + 86400000,
  });
  const db = new DatabaseSync(credentials);
  db.exec(
    "CREATE TABLE credentials (provider TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO credentials VALUES (?, ?)").run(
    "openai-codex",
    credential,
  );
  db.close();
  return {
    root,
    async start(mode: Mode, generation = join(root, randomUUID())) {
      await mkdir(generation, { recursive: true });
      const pair = {
        release: "a".repeat(40),
        generation: basename(generation),
        schema: 1,
      };
      await atomic(join(data, "control/manifest.json"), {
        kind: mode,
        active: pair,
        good: pair,
        failures: 0,
        ...(mode === "safe" ? { reason: "Synthetic owner recovery test" } : {}),
      });
      let port: number;
      do {
        port = await freePort();
      } while ([4317, 4319, 8090, 8096, 8264].includes(port));
      const base = `http://127.0.0.1:${port}`;
      const child = spawn(
        process.execPath,
        [
          "--import",
          join(dependencies, "tsx/dist/loader.mjs"),
          join(core, "core/child.ts"),
        ],
        {
          cwd: root,
          env: {
            ...cleanEnv(),
            HOME: join(root, "home"),
            TMPDIR: root,
            GAIA_RELEASE: pair.release,
            GAIA_RELEASE_DIR: release,
            GAIA_GENERATION: generation,
            GAIA_DATA_DIR: data,
            GAIA_CREDENTIALS: credentials,
            GAIA_HOST: "127.0.0.1",
            GAIA_PORT: String(port),
            GAIA_PROBE_TOKEN: "synthetic-probe-token",
            GAIA_CONTROL_SOCKET: join(root, "unused.sock"),
          },
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        },
      );
      let logs = "";
      for (const stream of [child.stdout, child.stderr])
        stream?.on("data", (chunk) => {
          logs = (logs + chunk).slice(-8000);
        });
      const exited = new Promise<void>((resolve) => {
        child.once("error", (error) => {
          logs += error.message;
          resolve();
        });
        child.once("exit", () => resolve());
      });
      let stopped = false;
      const stop = async () => {
        if (stopped) return;
        try {
          child.kill("SIGTERM");
          await within(exited, 5000, `Child did not exit.\n${logs}`);
          assert.equal(child.exitCode, 0, logs);
          const stats = Stats.parse(
            JSON.parse(
              await readFile(join(generation, "faux-exit.json"), "utf8"),
            ),
          );
          assert.deepEqual(stats.networkAttempts, []);
          const store = new DatabaseSync(credentials, { readOnly: true });
          try {
            assert.equal(
              store
                .prepare("SELECT value FROM credentials WHERE provider=?")
                .get("openai-codex")?.value,
              credential,
            );
          } finally {
            store.close();
          }
        } finally {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
            await within(exited, 2000, "Forced child cleanup did not finish.");
          }
          stopped = true;
        }
      };
      children.push({ stop });
      const Health = z.object({
        ok: z.literal(true),
        mode: z.literal(mode),
        provider: z.literal("pi-openai-codex"),
        release: z.literal(pair.release),
      });
      await until(
        async () => {
          assert(child.exitCode === null && child.signalCode === null, logs);
          try {
            const parsed = Health.safeParse(
              await (
                await fetch(base + "/healthz", {
                  signal: AbortSignal.timeout(500),
                })
              ).json(),
            );
            return parsed.success ? parsed.data : undefined;
          } catch {
            return undefined;
          }
        },
        (health) => health?.ok === true,
      );
      const request = (path: string, input?: unknown) =>
        fetch(base + "/api/v1/" + path, {
          method: input === undefined ? "GET" : "POST",
          headers: {
            "Content-Type": "application/json",
            "x-gaia-probe": "synthetic-probe-token",
          },
          ...(input === undefined ? {} : { body: JSON.stringify(input) }),
          signal: AbortSignal.timeout(3000),
        });
      const home = async () =>
        Snapshot.parse(await (await request("state")).json());
      const area = async (id: string) =>
        AreaSnapshot.parse(await (await request(`areas/${id}/state`)).json());
      const stats = async () => {
        const result = within(
          once(child, "message"),
          2000,
          "Faux stats did not arrive.",
        );
        child.send("faux-stats");
        return Stats.parse((await result)[0]);
      };
      return {
        generation,
        request,
        home,
        area,
        stats,
        stop,
        settled: (id?: string) =>
          until<Snapshot | AreaSnapshot>(
            id ? () => area(id) : home,
            (value) => value.thread.run.kind !== "running",
          ),
        async confirm() {
          const response = await request("workspace/propose", plan);
          assert.equal(response.status, 201, await response.clone().text());
          const proposal = WorkspaceProposal.parse(await response.json());
          const exact = {
            proposalId: proposal.proposalId,
            revision: proposal.revision,
          };
          assert.equal(
            (
              await request("workspace/confirm", {
                ...exact,
                revision: exact.revision + 1,
              })
            ).status,
            409,
          );
          const confirmed = await request("workspace/confirm", exact);
          assert.equal(confirmed.status, 200, await confirmed.clone().text());
          z.object({ kind: z.literal("confirmed") }).parse(
            await confirmed.json(),
          );
          assert.equal(proposal.workspace.kind, "multi");
          if (proposal.workspace.kind !== "multi")
            throw new Error("Expected multi workspace.");
          return { proposal, first: proposal.workspace.areas[0].areaId };
        },
        async privateHome() {
          assert.equal((await request("profile/skip", {})).status, 202);
          assert.equal(
            (
              await request("messages", {
                requestId: randomUUID(),
                text: "PRIVATE_HOME_MARKER",
              })
            ).status,
            202,
          );
          const snapshot = await until(
            home,
            (value) => value.thread.run.kind !== "running",
          );
          assert.equal(snapshot.connection.kind, "connected");
          assert.equal(
            snapshot.thread.messages.at(-1)?.text,
            answer,
            JSON.stringify({ snapshot, stats: await stats(), logs }),
          );
          return snapshot;
        },
      };
    },
  };
}

test(
  "installed managed child enables genuine areas, keeps the isolated probe disabled and retains Home in safe mode",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const live = await f.start("stable");
    const home = await live.privateHome();
    const profile = await readFile(join(live.generation, "owner-profile.json"));
    const { first } = await live.confirm();
    const workspace = WorkspaceState.parse(
      await (await live.request("workspace")).json(),
    );
    assert.equal(
      (
        await live.request(`areas/${first}/messages`, {
          requestId: randomUUID(),
          text: "PRIVATE_AREA_MARKER",
        })
      ).status,
      202,
    );
    const area = await live.settled(first);
    assert.equal(area.thread.messages.at(-1)?.text, answer);
    assert.deepEqual((await live.home()).thread, home.thread);
    const stats = await live.stats();
    assert.equal(stats.callCount, 2);
    assert(stats.contexts[0]?.tools.includes("route_to_area"));
    assert(stats.contexts[0]?.tools.includes("self_change"));
    assert.match(JSON.stringify(stats.contexts[1]), /PRIVATE_AREA_MARKER/);
    assert(!JSON.stringify(stats.contexts[1]).includes("PRIVATE_HOME_MARKER"));
    assert.deepEqual(stats.contexts[1]?.tools ?? [], []);
    const probe = WorkspaceProposal.parse(
      await (await live.request("probe/workspace/propose", plan)).json(),
    );
    assert.equal(
      (
        await live.request("probe/workspace/confirm", {
          proposalId: probe.proposalId,
          revision: probe.revision,
        })
      ).status,
      409,
    );
    assert.deepEqual(
      WorkspaceState.parse(
        await (await live.request("probe/workspace")).json(),
      ),
      { kind: "proposed", proposal: probe },
    );
    assert.deepEqual(
      Snapshot.parse(await (await live.request("probe/state")).json()).thread
        .messages,
      [],
    );
    assert.equal((await live.stats()).callCount, 2);
    await live.stop();
    const safe = await f.start("safe", live.generation);
    assert.deepEqual(
      WorkspaceState.parse(await (await safe.request("workspace")).json()),
      workspace,
    );
    assert.deepEqual((await safe.home()).thread, home.thread);
    assert.equal((await safe.home()).runtime?.mode, "safe");
    assert.equal((await safe.home()).runtime?.selfModification, false);
    assert.equal(
      (
        await safe.request(`areas/${first}/messages`, {
          requestId: randomUUID(),
          text: "Do not run",
        })
      ).status,
      409,
    );
    assert.equal((await safe.request(`areas/${first}/retry`, {})).status, 409);
    assert.equal((await safe.stats()).callCount, 0);
    assert.equal(
      (
        await safe.request("messages", {
          requestId: randomUUID(),
          text: "Explicit Home action in safe mode",
        })
      ).status,
      202,
    );
    assert.equal((await safe.settled()).thread.messages.at(-1)?.text, answer);
    const safeStats = await safe.stats();
    assert.equal(safeStats.callCount, 1);
    assert.match(JSON.stringify(safeStats.contexts[0]), /PRIVATE_HOME_MARKER/);
    assert(
      !JSON.stringify(safeStats.contexts[0]).includes("PRIVATE_AREA_MARKER"),
    );
    assert(
      !safeStats.contexts[0]?.tools.some((tool) =>
        ["route_to_area", "self_change"].includes(tool),
      ),
    );
    assert.deepEqual(
      await readFile(join(safe.generation, "owner-profile.json")),
      profile,
    );
    await safe.stop();
    const fresh = await f.start("safe");
    const proposed = await fresh.request("workspace/propose", plan);
    assert.equal(proposed.status, 201);
    const pending = WorkspaceProposal.parse(await proposed.json());
    assert.equal(
      (
        await fresh.request("workspace/confirm", {
          proposalId: pending.proposalId,
          revision: pending.revision,
        })
      ).status,
      409,
    );
    assert.equal((await fresh.stats()).callCount, 0);
    assert.deepEqual(
      WorkspaceState.parse(await (await fresh.request("workspace")).json()),
      { kind: "proposed", proposal: pending },
    );
  },
);

for (const mode of ["stable", "safe"] as const)
  for (const pendingKind of [
    "SYNTHETIC_WAIT_FOR_ABORT",
    "SYNTHETIC_DEFERRED",
  ] as const)
    test(
      `installed ${mode} child recovers ownerless ${pendingKind} without provider activity`,
      { timeout: 30000 },
      async (t) => {
        const f = await fixture(t);
        const live = await f.start("stable");
        const home = await live.privateHome();
        const profile = await readFile(
          join(live.generation, "owner-profile.json"),
        );
        const { first } = await live.confirm();
        assert.equal(
          (
            await live.request(`areas/${first}/messages`, {
              requestId: randomUUID(),
              text: "PRIVATE_AREA_HISTORY",
            })
          ).status,
          202,
        );
        const previous = await live.settled(first);
        const requestId = randomUUID();
        assert.equal(
          (
            await live.request(`areas/${first}/messages`, {
              requestId,
              text: pendingKind,
            })
          ).status,
          202,
        );
        await until(live.stats, (stats) => stats.callCount === 3);
        const captured = join(f.root, randomUUID());
        await mkdir(captured);
        vacuum(
          join(live.generation, "gaia.sqlite"),
          join(captured, "gaia.sqlite"),
        );
        const before = await until(
          async () => {
            await rm(join(captured, "pi.sqlite"), { force: true });
            vacuum(
              join(live.generation, "pi.sqlite"),
              join(captured, "pi.sqlite"),
            );
            return inspect(join(captured, "pi.sqlite"));
          },
          (snapshot) =>
            pendingKind === "SYNTHETIC_WAIT_FOR_ABORT" ||
            snapshot.inspection.tasks.some(
              (task) => task.record.state.status === "sleeping",
            ),
        );
        await cp(
          join(live.generation, "owner-profile.json"),
          join(captured, "owner-profile.json"),
        );
        assert.equal(before.inspection.tasks.length, 1);
        assert.equal(before.inspection.submissions.length, 1);
        assert(before.pending);
        assert.equal(before.pending.requestId, requestId);
        assert(before.context);
        assert(JSON.stringify(before.context).includes(pendingKind));
        assert.match(JSON.stringify(before.context), /PRIVATE_AREA_HISTORY/);
        assert(!JSON.stringify(before.context).includes("PRIVATE_HOME_MARKER"));
        assert.equal((await live.area(first)).thread.run.kind, "running");
        assert.equal((await live.stats()).aborted, 0);
        await live.stop();
        assert.equal(
          Stats.parse(
            JSON.parse(
              await readFile(join(live.generation, "faux-exit.json"), "utf8"),
            ),
          ).aborted,
          pendingKind === "SYNTHETIC_WAIT_FOR_ABORT" ? 1 : 0,
        );
        const reopened = await f.start(mode, captured);
        assert.deepEqual((await reopened.home()).thread, home.thread);
        assert.deepEqual(
          await readFile(join(captured, "owner-profile.json")),
          profile,
        );
        await delay(150);
        assert.deepEqual(await reopened.stats(), {
          callCount: 0,
          deferredFetchCount: 0,
          cancelledDeferred: [],
          contexts: [],
          aborted: 0,
          networkAttempts: [],
        });
        if (mode === "stable") {
          const restored = await reopened.area(first);
          assert.equal(restored.thread.run.kind, "error");
          assert.deepEqual(
            restored.thread.messages.slice(0, previous.thread.messages.length),
            previous.thread.messages,
          );
          assert(
            restored.thread.messages.some(
              (message) => message.id === requestId,
            ),
          );
        } else {
          assert.equal(
            (
              await reopened.request(`areas/${first}/messages`, {
                requestId: randomUUID(),
                text: "Refuse area execution",
              })
            ).status,
            409,
          );
        }
        assert.equal(
          (
            await reopened.request("messages", {
              requestId: randomUUID(),
              text: "Explicit owner action after recovery",
            })
          ).status,
          202,
        );
        assert.equal(
          (await reopened.settled()).thread.messages.at(-1)?.text,
          answer,
        );
        const stats = await reopened.stats();
        assert.equal(stats.callCount, 1);
        assert.match(JSON.stringify(stats.contexts[0]), /PRIVATE_HOME_MARKER/);
        assert(
          !JSON.stringify(stats.contexts[0]).includes("PRIVATE_AREA_HISTORY"),
        );
        assert.equal(stats.deferredFetchCount, 0);
        assert.deepEqual(stats.cancelledDeferred, []);
        await reopened.stop();
        const after = await Harness.open(
          await openNodeSqliteStorage(join(captured, "pi.sqlite")),
          { models: createModels(), registry: createRegistry() },
          ctx,
        );
        try {
          assert.deepEqual((await after.inspect(ctx)).tasks, []);
          assert.deepEqual((await after.inspect(ctx)).submissions, []);
          const submission = await after.submission(before.pending.id, ctx);
          assert(submission);
          const status = await submission.status(ctx);
          assert.equal(status.status, "unanswered");
          if (status.status === "unanswered")
            assert.equal(status.reason, "aborted");
          const area = await after.conversation(
            before.pending.conversationId,
            ctx,
          );
          assert(area);
          const retained = await area.context(ctx);
          assert.deepEqual(
            retained.entries.slice(0, before.context.entries.length),
            before.context.entries,
          );
          assert.match(JSON.stringify(retained), /PRIVATE_AREA_HISTORY/);
        } finally {
          await after.close(ctx);
        }
      },
    );
