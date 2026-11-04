import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";
import {
  Harness,
  createRegistry,
  defineExtension,
  defineTask,
  type HarnessOptions,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { openRecoveredHarness } from "./workspace-recovery.ts";

function signal() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test(
  "restart cancels Home, ownerless areas, queued writes and background work before any model call",
  { timeout: 15000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "gaia-recovery-"));
    const path = join(directory, "pi.sqlite");
    const faux = fauxProvider({
      provider: "recovery-test",
      models: [{ id: "model" }],
      tokensPerSecond: 100,
      tokenSize: { min: 1, max: 1 },
    });
    const models = createModels();
    models.setProvider(faux.provider);
    const registry = createRegistry();
    let ranBackground = 0;
    let abortedBackground = 0;
    const sleeping = signal();
    const background = defineTask<null, { phase: "sleep" }, null>({
      name: "recovery-test.background",
      version: 1,
      initial: () => ({ phase: "sleep" }),
      phases: {
        sleep: async (_task, runtime, context) => {
          ranBackground++;
          await runtime.sleepUntil(
            Date.now() + 60000,
            { phase: "sleep" },
            context,
          );
          sleeping.resolve();
        },
      },
      abort: async (_task, runtime, context) => {
        abortedBackground++;
        await runtime.commit(
          () => ({ status: "terminal", outcome: { status: "aborted" } }),
          context,
        );
      },
    });
    registry.install(
      defineExtension({ name: "recovery-test", tasks: [background] }),
    );
    const options: HarnessOptions = {
      models,
      registry,
      settings: { compaction: { enabled: false }, retry: { maxRetries: 0 } },
    };
    let harness = await Harness.open(
      await openNodeSqliteStorage(path),
      options,
      ctx,
    );
    t.after(async () => {
      await harness.close(ctx);
      await rm(directory, { recursive: true, force: true });
    });
    const home = await harness.root(ctx, {
      agent: { model: { provider: "recovery-test", modelId: "model" } },
    });
    const areaA = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: {
          model: { provider: "recovery-test", modelId: "model" },
          extensions: [],
        },
      },
      ctx,
    );
    const areaB = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: {
          model: { provider: "recovery-test", modelId: "model" },
          extensions: [],
        },
      },
      ctx,
    );
    const backgroundId = await harness.commit(
      (tx) =>
        tx.createTask(background, null, {
          conversationId: areaB.id,
          ownership: { kind: "conversation" },
          background: true,
        }),
      ctx,
    );
    const started = signal();
    let requests = 0;
    faux.setResponses(
      [home, areaA, areaB].map(() => () => {
        if (++requests === 3) started.resolve();
        return fauxAssistantMessage("A".repeat(10000));
      }),
    );
    const live = [];
    const queued = [];
    for (const chat of [home, areaA, areaB]) {
      live.push(
        await chat.submit(
          {
            type: "input",
            content: "Synthetic interrupted input",
            requestId: `live-${chat.id}`,
          },
          ctx,
        ),
      );
      queued.push(
        await chat.submit(
          {
            type: "input",
            content: "Synthetic follow-up",
            whenBusy: "followUp",
            requestId: `queued-${chat.id}`,
          },
          ctx,
        ),
      );
      queued.push(
        await chat.submit(
          {
            type: "write",
            entry: {
              kind: "test.queued",
              model: [
                {
                  role: "user",
                  content: "DO_NOT_PLACE_AFTER_RESTART",
                  timestamp: 0,
                },
              ],
            },
          },
          ctx,
        ),
      );
    }
    await started.promise;
    await sleeping.promise;
    const before = await harness.inspect(ctx);
    assert.equal(before.tasks.length, 4);
    assert.equal(
      before.submissions.filter((item) => item.status === "queued").length,
      6,
    );
    assert(before.tasks.some((task) => task.record.background));
    await harness.close(ctx);
    const callsBeforeRestart = faux.state.callCount;
    assert.equal(callsBeforeRestart, 3);
    const restarted = await openRecoveredHarness(
      await openNodeSqliteStorage(path),
      options,
      ctx,
    );
    harness = restarted.harness;
    const interrupted = restarted.interrupted;
    assert.equal(faux.state.callCount, callsBeforeRestart);
    assert.equal(faux.state.deferredFetchCount, 0);
    assert.deepEqual(faux.state.cancelledDeferred, []);
    assert.equal(interrupted.tasks.length, 4);
    assert.equal(interrupted.submissions.length, 9);
    assert(
      interrupted.submissions.some(
        (submission) => submission.requestId === `live-${areaA.id}`,
      ),
    );
    assert.equal(
      new Set(interrupted.tasks.map((task) => task.conversationId)).size,
      3,
    );
    assert.equal(ranBackground, 1);
    assert.equal(abortedBackground, 1);
    assert.equal(
      (await harness.getTask(backgroundId, ctx))?.state.status,
      "terminal",
    );
    for (const item of [...live, ...queued]) {
      const submission = await harness.submission(item.id, ctx);
      assert(submission);
      const result = await submission.status(ctx);
      assert.equal(result.status, "unanswered");
      assert.equal(result.reason, "aborted");
    }
    assert.deepEqual((await harness.inspect(ctx)).tasks, []);
    assert.deepEqual((await harness.inspect(ctx)).submissions, []);
    for (const chat of [home, areaA, areaB]) {
      const restored = await harness.conversation(chat.id, ctx);
      assert(restored);
      assert(
        !JSON.stringify((await restored.context(ctx)).entries).includes(
          "DO_NOT_PLACE_AFTER_RESTART",
        ),
      );
    }
    // Allow a scheduler turn after cleanup, before the next explicit action.
    await setTimeout(25);
    assert.equal(faux.state.callCount, callsBeforeRestart);
    faux.setResponses([fauxAssistantMessage("OK")]);
    const restoredArea = await harness.conversation(areaA.id, ctx);
    assert(restoredArea);
    const next = await restoredArea.submit(
      { type: "input", content: "Explicit new user action" },
      ctx,
    );
    assert.equal((await next.wait(ctx)).status, "done");
    assert.equal(faux.state.callCount, callsBeforeRestart + 1);
  },
);

test(
  "reopened Harness remains paused until recovery explicitly cancels interrupted admissions",
  { timeout: 10000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "gaia-paused-recovery-"));
    const path = join(directory, "pi.sqlite");
    const faux = fauxProvider({
      provider: "paused-test",
      models: [{ id: "model" }],
      tokensPerSecond: 100,
      tokenSize: { min: 1, max: 1 },
    });
    const models = createModels();
    models.setProvider(faux.provider);
    const options: HarnessOptions = {
      models,
      registry: createRegistry(),
      settings: { compaction: { enabled: false }, retry: { maxRetries: 0 } },
    };
    let harness = await Harness.open(
      await openNodeSqliteStorage(path),
      options,
      ctx,
    );
    t.after(async () => {
      await harness.close(ctx);
      await rm(directory, { recursive: true, force: true });
    });
    const home = await harness.root(ctx, {
      agent: { model: { provider: "paused-test", modelId: "model" } },
    });
    faux.setResponses([fauxAssistantMessage("A".repeat(10000))]);
    const live = await harness.commit(
      (tx) => home.submit(tx, { type: "input", content: "Never started" }),
      ctx,
    );
    const queued = await harness.commit(
      (tx) =>
        home.submit(tx, {
          type: "input",
          content: "Never placed",
          whenBusy: "followUp",
        }),
      ctx,
    );
    await harness.close(ctx);
    const callsBeforeRestart = faux.state.callCount;
    harness = await Harness.open(
      await openNodeSqliteStorage(path),
      options,
      ctx,
    );
    assert.equal((await harness.inspect(ctx)).scheduling, "paused");
    await setTimeout(25);
    assert.equal(faux.state.callCount, callsBeforeRestart);
    await harness.close(ctx);
    const restarted = await openRecoveredHarness(
      await openNodeSqliteStorage(path),
      options,
      ctx,
    );
    harness = restarted.harness;
    const interrupted = restarted.interrupted;
    assert.equal(interrupted.tasks.length, 1);
    assert.equal(interrupted.submissions.length, 2);
    assert.equal(faux.state.callCount, callsBeforeRestart);
    for (const id of [live, queued])
      assert.equal(
        (await (await harness.submission(id, ctx))?.status(ctx))?.status,
        "unanswered",
      );
    await harness.close(ctx);
    const clean = await openRecoveredHarness(
      await openNodeSqliteStorage(path),
      { ...options, models: () => models },
      ctx,
    );
    harness = clean.harness;
    assert.deepEqual(clean.interrupted, { tasks: [], submissions: [] });
    assert.equal(faux.state.callCount, callsBeforeRestart);
  },
);

test(
  "recovery does not fetch or cancel a persisted deferred provider response",
  { timeout: 10000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "gaia-deferred-recovery-"));
    const path = join(directory, "pi.sqlite");
    const faux = fauxProvider({
      provider: "deferred-test",
      models: [{ id: "model" }],
      tokensPerSecond: 100000,
    });
    const models = createModels();
    models.setProvider(faux.provider);
    const options: HarnessOptions = {
      models,
      registry: createRegistry(),
      settings: { compaction: { enabled: false }, retry: { maxRetries: 0 } },
    };
    let harness = await Harness.open(
      await openNodeSqliteStorage(path),
      options,
      ctx,
    );
    t.after(async () => {
      await harness.close(ctx);
      await rm(directory, { recursive: true, force: true });
    });
    const home = await harness.root(ctx, {
      agent: { model: { provider: "deferred-test", modelId: "model" } },
    });
    faux.setResponses([
      fauxAssistantMessage("", {
        stopReason: "deferred",
        deferred: {
          id: "synthetic-deferred",
          provider: "deferred-test",
          modelId: "model",
          api: faux.api,
          pollAfterMs: 60000,
        },
      }),
    ]);
    const input = await home.submit(
      { type: "input", content: "Deferred synthetic input" },
      ctx,
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        (await harness.inspect(ctx)).tasks.some(
          (task) => task.record.state.status === "sleeping",
        )
      )
        break;
      await setTimeout(5);
    }
    assert(
      (await harness.inspect(ctx)).tasks.some(
        (task) => task.record.state.status === "sleeping",
      ),
    );
    await harness.close(ctx);
    assert.equal(faux.state.callCount, 1);
    const restarted = await openRecoveredHarness(
      await openNodeSqliteStorage(path),
      options,
      ctx,
    );
    harness = restarted.harness;
    assert.equal(restarted.interrupted.tasks.length, 1);
    assert.equal(
      (await (await harness.submission(input.id, ctx))?.status(ctx))?.status,
      "unanswered",
    );
    assert.equal(faux.state.callCount, 1);
    assert.equal(faux.state.deferredFetchCount, 0);
    assert.deepEqual(faux.state.cancelledDeferred, []);
  },
);
