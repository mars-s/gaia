import { registerPlanAvailability } from "../../core/plan-models.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createAuth } from "./auth.ts";
import { openDatabase } from "./server.ts";
import { conversationAdapter } from "./pi-conversation.ts";
import { deferred } from "./testing/workspace.ts";

test(
  "a watch setup failure aborts and joins the real ownerless generation before a later explicit request",
  { timeout: 10000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "gaia-watch-failure-"));
    const db = await openDatabase(dir);
    const auth = createAuth(db);
    const faux = fauxProvider({
      provider: "openai-codex",
      models: [{ id: "gpt-6.1-sol" }],
      tokensPerSecond: 100000,
    });
    auth.models.setProvider(faux.provider);
    registerPlanAvailability(auth.models, (provider) => provider === "openai-codex");
    const harness = await Harness.open(
      await openNodeSqliteStorage(join(dir, "pi.sqlite")),
      {
        models: auth.models,
        registry: createRegistry(),
        settings: { retry: { maxRetries: 0 } },
      },
      ctx,
    );
    await harness.root(ctx);
    const area = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: { provider: "openai-codex", modelId: "gpt-6.1-sol" } },
      },
      ctx,
    );
    t.after(async () => {
      await area.abort(ctx);
      await harness.close(ctx);
      await auth.close();
      db.close();
      await rm(dir, { recursive: true, force: true });
    });
    const adapter = await conversationAdapter(area, harness, auth.models, ctx);
    const started = deferred();
    let cancelled = false;
    faux.setResponses([
      async (_context, options) => {
        assert(options?.signal);
        started.resolve();
        if (!options.signal.aborted)
          await new Promise<void>((resolve) =>
            options.signal?.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          );
        cancelled = true;
        return fauxAssistantMessage("", { stopReason: "aborted" });
      },
    ]);
    const watch = t.mock.method(area, "watch", async () => {
      await started.promise;
      throw new Error("Injected watch setup failure");
    });
    await assert.rejects(
      adapter.run({
        text: "Synthetic interrupted request",
        requestId: randomUUID(),
        onText() {},
        signal: new AbortController().signal,
      }),
      /Injected watch setup failure/,
    );
    assert(
      cancelled,
      "Failure must return only after the provider received and settled cancellation",
    );
    const inspection = await harness.inspect(ctx);
    assert.deepEqual(inspection.tasks, []);
    assert.deepEqual(inspection.submissions, []);
    watch.mock.restore();
    faux.setResponses([
      fauxAssistantMessage("Only the explicit next request ran."),
    ]);
    let text = "";
    await adapter.run({
      text: "An explicit next request",
      requestId: randomUUID(),
      onText(value) {
        text = value;
      },
      signal: new AbortController().signal,
    });
    assert.equal(text, "Only the explicit next request ran.");
    assert.equal(faux.state.callCount, 2);
  },
);
