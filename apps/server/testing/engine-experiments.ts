// Opt-in measurement: npx tsx apps/server/testing/engine-experiments.ts
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";
import {
  Harness,
  createRegistry,
  defineDoc,
  defineDocFamily,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { conversationAdapter } from "../pi-conversation.ts";

const workers = 16;
const text = "Synthetic streaming workload. ".repeat(128);
type Projection = { text: string; writes: number; retained: string };
const family = defineDocFamily<Projection, null>({
  kind: "gaia.experiment-stream",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ text: "", writes: 0, retained: "r".repeat(8192) }),
  checkpointWhen: () => true,
});
const shared = defineDoc<{ workers: Projection[] }>({
  kind: "gaia.experiment-shared",
  version: 1,
  scope: "session",
  initial: () => ({
    workers: Array.from({ length: workers }, () =>
      family.definition.initial(null),
    ),
  }),
  checkpointWhen: () => true,
});
const percentile = (values: number[], fraction: number) =>
  values[Math.ceil(values.length * fraction) - 1];

async function measure(layout: "family" | "shared") {
  const directory = await mkdtemp(join(tmpdir(), "gaia-engine-bench-"));
  const path = join(directory, "pi.sqlite");
  const faux = fauxProvider({
    provider: "openai-codex",
    models: [{ id: "model" }],
    tokensPerSecond: 2048,
    tokenSize: { min: 64, max: 64 },
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const harness = await Harness.open(
    await openNodeSqliteStorage(path),
    {
      models,
      registry: createRegistry(),
      settings: {
        compaction: { enabled: false },
        retry: { maxRetries: 0 },
        progress: { partialIntervalMs: 0 },
      },
    },
    ctx,
  );
  const latency: number[] = [];
  let pending = 0;
  let peakPending = 0;
  let peakLiveTasks = 0;
  let callbacks = 0;
  let activeStreams = 0;
  let peakStreams = 0;
  try {
    const adapters = [];
    for (let index = 0; index < workers; index++) {
      const conversation = await harness.createConversation(
        {
          ownership: { kind: "ownerless" },
          agent: {
            model: { provider: "openai-codex", modelId: "model" },
            extensions: [],
          },
        },
        ctx,
      );
      adapters.push(
        await conversationAdapter(conversation, harness, models, ctx, { connectedProviders: () => new Set(["openai-codex"]) }),
      );
    }
    await harness.commit(async (tx) => {
      if (layout === "shared") await tx.doc(shared);
      else
        for (let index = 0; index < workers; index++)
          await tx.doc(family, String(index), null);
    }, ctx);
    faux.setResponses(
      Array.from({ length: workers }, () => () => {
        activeStreams++;
        peakStreams = Math.max(peakStreams, activeStreams);
        return fauxAssistantMessage(text);
      }),
    );
    const started = performance.now();
    await Promise.all(
      adapters.map(async (adapter, index) => {
        let progress = Promise.resolve();
        await adapter.run({
          text: "Stream synthetic text",
          requestId: `stream-${index}`,
          signal: new AbortController().signal,
          onText(value) {
            callbacks++;
            progress = progress.then(async () => {
              const before = performance.now();
              pending++;
              peakPending = Math.max(peakPending, pending);
              try {
                await harness.commit(async (tx) => {
                  const doc =
                    layout === "shared"
                      ? (await tx.doc(shared)).workers[index]
                      : await tx.doc(family, String(index), null);
                  doc.text = value;
                  doc.writes++;
                }, ctx);
                latency.push(performance.now() - before);
              } finally {
                pending--;
              }
            });
          },
        });
        activeStreams--;
        peakLiveTasks = Math.max(
          peakLiveTasks,
          (await harness.inspect(ctx)).tasks.length,
        );
        await progress;
      }),
    );
    const seconds = (performance.now() - started) / 1000;
    const inspection = await harness.inspect(ctx);
    assert.deepEqual(inspection.tasks, []);
    assert.deepEqual(inspection.submissions, []);
    assert.equal(pending, 0);
    assert.equal(activeStreams, 0);
    assert.equal(peakStreams, workers);
    assert.equal(faux.state.callCount, workers);
    for (let index = 0; index < workers; index++) {
      const value =
        layout === "shared"
          ? (await harness.snapshot(shared, ctx))?.workers[index]
          : await harness.snapshot(family, String(index), ctx);
      assert.equal(value?.text, text);
      assert(value.writes > 0);
    }
    latency.sort((a, b) => a - b);
    return {
      layout,
      workers,
      callbacks,
      commits: latency.length,
      seconds,
      commitsPerSecond: latency.length / seconds,
      p50Ms: percentile(latency, 0.5),
      p95Ms: percentile(latency, 0.95),
      maxMs: latency.at(-1),
      peakPending,
      peakStreams,
      peakLiveTasksAtCompletion: peakLiveTasks,
      liveTasksAtEnd: inspection.tasks.length,
      pendingAtEnd: pending,
      sqliteBytes: (await stat(path)).size,
    };
  } finally {
    await harness.close(ctx);
    await rm(directory, { recursive: true, force: true });
  }
}

console.log(
  JSON.stringify({
    context: {
      date: new Date().toISOString(),
      node: process.version,
      platform: platform(),
      release: release(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      memoryGiB: totalmem() / 2 ** 30,
      pi: "1.5.0",
      workers,
      responseCharacters: text.length,
      retainedBytesPerWorker: 8192,
      tokensPerSecond: 2048,
      tokenSize: 64,
      checkpointEveryCommit: true,
      partialIntervalMs: 0,
    },
  }),
);
for (let repeat = 1; repeat <= 3; repeat++) {
  for (const layout of repeat % 2
    ? (["family", "shared"] as const)
    : (["shared", "family"] as const)) {
    console.log(JSON.stringify({ repeat, ...(await measure(layout)) }));
  }
}
