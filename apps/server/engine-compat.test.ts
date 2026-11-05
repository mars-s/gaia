import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
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
  configure,
  type TaskId,
  type ConversationId,
  type SubmissionId,
  createRegistry,
  defineDoc,
  defineExtension,
  defineTask,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { openRecoveredHarness } from "./workspace-recovery.ts";

const Evidence = defineDoc<{ effect: "unsafe-unreconciled"; retained: string }>(
  {
    kind: "gaia.experiment-evidence",
    version: 1,
    scope: "session",
    initial: () => ({
      effect: "unsafe-unreconciled",
      retained: "synthetic old-readable JSON",
    }),
    checkpointWhen: () => true,
  },
);

for (const state of ["queued", "live"] as const) {
  test(
    `custom task recovery from ${state}: missing definition versus abort-only bridge`,
    { timeout: 15000 },
    async (t) => {
      const directory = await mkdtemp(join(tmpdir(), "gaia-engine-compat-"));
      t.after(() => rm(directory, { recursive: true, force: true }));
      const source = join(directory, "source.sqlite");
      const faux = fauxProvider({
        provider: "engine-compat",
        models: [{ id: "model" }],
        tokensPerSecond: 100,
        tokenSize: { min: 1, max: 1 },
      });
      const models = createModels();
      models.setProvider(faux.provider);
      let phases = 0;
      let aborts = 0;
      const task = defineTask<null, { phase: "hold" }, null>({
        name: "gaia.experiment-background",
        version: 1,
        initial: () => ({ phase: "hold" }),
        phases: {
          hold: async (_task, runtime, context) => {
            phases++;
            await runtime.sleepUntil(
              Date.now() + 60000,
              { phase: "hold" },
              context,
            );
          },
        },
        abort: async (_task, runtime, context) => {
          aborts++;
          await runtime.commit(
            () => ({ status: "terminal", outcome: { status: "aborted" } }),
            context,
          );
        },
      });
      const registry = createRegistry();
      registry.install(
        defineExtension({ name: "engine-experiment", tasks: [task] }),
      );
      const options = {
        models,
        registry,
        settings: { compaction: { enabled: false }, retry: { maxRetries: 0 } },
      };
      let harness = await Harness.open(
        await openNodeSqliteStorage(source),
        options,
        ctx,
      );
      const root = await harness.root(ctx);
      await harness.close(ctx);
      harness = await Harness.open(
        await openNodeSqliteStorage(source),
        options,
        ctx,
      );
      let ids:
        | {
            taskId: TaskId;
            workerId: ConversationId;
            submissionId?: SubmissionId;
          }
        | undefined;
      try {
        ids = await harness.commit(async (tx) => {
          await tx.doc(Evidence);
          const taskId = await tx.createTask(task, null, {
            conversationId: root.id,
            ownership: { kind: "conversation" },
            background: true,
            abandonOnRestart: true,
          });
          const worker = await tx.createConversation({
            ownership: { kind: "task", taskId },
          });
          await configure(tx, worker.id, {
            model: { provider: "engine-compat", modelId: "model" },
            extensions: [],
          });
          return { taskId, workerId: worker.id };
        }, ctx);
        if (state === "live") {
          const worker = await harness.conversation(ids.workerId, ctx);
          assert(worker);
          const submissionId = await harness.commit(
            (tx) =>
              worker.submit(tx, {
                type: "input",
                content: "Synthetic interrupted work, no tools",
              }),
            ctx,
          );
          ids = { ...ids, submissionId };
          faux.setResponses([
            fauxAssistantMessage("Synthetic stream ".repeat(1000)),
          ]);
          harness.resume();
          for (let attempt = 0; attempt < 1000; attempt++) {
            if (phases === 1 && faux.state.callCount === 1) break;
            await setTimeout(5);
          }
          assert.equal(phases, 1);
          assert.equal(faux.state.callCount, 1);
        } else {
          assert.equal((await harness.inspect(ctx)).scheduling, "paused");
          assert.equal(faux.state.callCount, 0);
        }
        const captured = await harness.inspect(ctx);
        assert.equal(captured.tasks.length, state === "live" ? 2 : 1);
        const custom = captured.tasks.find(
          ({ record }) => record.id === ids?.taskId,
        );
        assert.equal(
          custom?.record.state.status,
          state === "live" ? "sleeping" : "pending",
        );
        assert.equal(custom?.record.background, true);
        const workerId = ids.workerId;
        const workerRecord = await harness.commit(
          (tx) => tx.conversation(workerId),
          ctx,
        );
        assert.deepEqual(workerRecord?.owner, {
          conversationId: root.id,
          taskId: ids.taskId,
        });
      } finally {
        await harness.close(ctx);
      }
      assert(ids);
      const before = faux.state.callCount;
      const phasesBefore = phases;
      for (const bridge of [false, true]) {
        const path = join(directory, `${bridge ? "bridge" : "missing"}.sqlite`);
        await copyFile(source, path);
        const olderRegistry = createRegistry();
        if (bridge) {
          const abortOnly = defineTask<null, { phase: "hold" }, null>({
            name: task.definition.name,
            version: 1,
            initial: () => ({ phase: "hold" }),
            phases: {
              hold: async () => {
                throw new Error("Abort bridge must never execute work");
              },
            },
            abort: task.definition.abort,
          });
          olderRegistry.install(
            defineExtension({
              name: "engine-abort-bridge",
              tasks: [abortOnly],
            }),
          );
        }
        const recovered = await openRecoveredHarness(
          await openNodeSqliteStorage(path),
          { ...options, registry: olderRegistry },
          ctx,
        );
        try {
          assert.equal(
            recovered.interrupted.tasks.length,
            state === "live" ? 2 : 1,
          );
          assert.equal(
            recovered.interrupted.submissions.length,
            state === "live" ? 1 : 0,
          );
          const parent: Awaited<ReturnType<Harness["getTask"]>> =
            await recovered.harness.getTask(ids.taskId, ctx);
          assert.equal(parent?.state.status, "terminal");
          if (parent?.state.status !== "terminal")
            throw new Error("Parent did not settle");
          assert.equal(
            parent.state.outcome.status,
            bridge ? "aborted" : "orphaned",
          );
          assert.equal(aborts, bridge ? 1 : 0);
          if (ids.submissionId) {
            const submission = await recovered.harness.submission(
              ids.submissionId,
              ctx,
            );
            assert(submission);
            assert.equal((await submission.status(ctx)).status, "unanswered");
          }
          assert(await recovered.harness.conversation(ids.workerId, ctx));
          assert.deepEqual(await recovered.harness.snapshot(Evidence, ctx), {
            effect: "unsafe-unreconciled",
            retained: "synthetic old-readable JSON",
          });
          assert.deepEqual((await recovered.harness.inspect(ctx)).tasks, []);
          assert.deepEqual(
            (await recovered.harness.inspect(ctx)).submissions,
            [],
          );
          await setTimeout(25);
          assert.equal(faux.state.callCount, before);
          assert.equal(phases, phasesBefore);
          assert.equal(faux.state.deferredFetchCount, 0);
          assert.deepEqual(faux.state.cancelledDeferred, []);
          t.diagnostic(
            JSON.stringify({
              state,
              bridge,
              outcome: parent.state.outcome,
              replayProviderCalls: faux.state.callCount - before,
              replayPhases: phases - phasesBefore,
            }),
          );
        } finally {
          await recovered.harness.close(ctx);
        }
      }
    },
  );
}
