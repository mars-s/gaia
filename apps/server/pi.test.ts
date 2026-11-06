import { registerPlanAvailability } from "../../core/plan-models.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createAuth } from "./auth.ts";
import { createPi } from "./pi.ts";
import { openDatabase } from "./server.ts";
test(
  "adapter recovery settles ownerless interrupted work before enabling providers",
  { timeout: 10000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "gaia-adapter-recovery-"));
    const db = await openDatabase(dir);
    const auth = createAuth(db);
    const faux = fauxProvider({
      provider: "openai-codex",
      models: [{ id: "gpt-6.1-sol" }],
      tokensPerSecond: 10,
    });
    auth.models.setProvider(faux.provider);
    registerPlanAvailability(auth.models, (provider) => provider === "openai-codex");
    const path = join(dir, "pi.sqlite");
    const harness = await Harness.open(
      await openNodeSqliteStorage(path),
      {
        models: auth.models,
        registry: createRegistry(),
      },
      ctx,
    );
    const home = await harness.root(ctx, {
      agent: { model: { provider: "openai-codex", modelId: "gpt-6.1-sol" } },
    });
    const area = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: { provider: "openai-codex", modelId: "gpt-6.1-sol" } },
      },
      ctx,
    );
    let started = () => {};
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    faux.setResponses([
      () => {
        started();
        return fauxAssistantMessage(
          "Synthetic interrupted answer ".repeat(100),
        );
      },
    ]);
    const live = await area.submit(
      { type: "input", content: "Synthetic pending area request" },
      ctx,
    );
    const queued = await area.submit(
      { type: "input", content: "Never run", whenBusy: "followUp" },
      ctx,
    );
    await running;
    await harness.close(ctx);
    const calls = faux.state.callCount;
    const adapter = await createPi(path, auth);
    await adapter.close();
    const observer = await Harness.open(
      await openNodeSqliteStorage(path),
      {
        models: auth.models,
        registry: createRegistry(),
      },
      ctx,
    );
    try {
      assert.equal(faux.state.callCount, calls);
      assert.deepEqual((await observer.inspect(ctx)).tasks, []);
      assert.deepEqual((await observer.inspect(ctx)).submissions, []);
      for (const id of [live.id, queued.id])
        assert.equal(
          (await (await observer.submission(id, ctx))?.status(ctx))?.status,
          "unanswered",
        );
      assert.deepEqual(
        (await (await observer.conversation(home.id, ctx))?.context(ctx))
          ?.entries,
        [],
      );
    } finally {
      await observer.close(ctx);
      await auth.close();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
test("real Pi Durable SQLite adapter streams a test-only provider and reloads conversation context", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-pi-"));
  const db = await openDatabase(dir);
  const auth = createAuth(db);
  const faux = fauxProvider({
    provider: "openai-codex",
    models: [{ id: "gpt-6.1-sol" }],
    tokensPerSecond: 100,
    tokenSize: { min: 2, max: 2 },
  });
  auth.models.setProvider(faux.provider);
    registerPlanAvailability(auth.models, (provider) => provider === "openai-codex");
  faux.setResponses([
    fauxAssistantMessage("Deterministic Pi adapter test response."),
  ]);
  let pi = await createPi(join(dir, "pi.sqlite"), auth);
  try {
    const updates: string[] = [];
    await pi.run({
      text: "Remember the word eucalyptus.",
      requestId: randomUUID(),
      onText: (text) => updates.push(text),
      signal: new AbortController().signal,
    });
    assert.equal(updates.at(-1), "Deterministic Pi adapter test response.");
    assert(
      updates.length > 1,
      "Expected streamed partials before final response",
    );
    await pi.close();
    pi = await createPi(join(dir, "pi.sqlite"), auth);
    faux.setResponses([
      (context) => {
        assert(
          context.messages.some(
            (message) =>
              message.role === "user" &&
              JSON.stringify(message.content).includes("eucalyptus"),
          ),
        );
        return fauxAssistantMessage("Context survived restart.");
      },
    ]);
    let answer = "";
    await pi.run({
      text: "What did I ask you to remember?",
      requestId: randomUUID(),
      onText: (text) => {
        answer = text;
      },
      signal: new AbortController().signal,
    });
    assert.equal(answer, "Context survived restart.");
  } finally {
    await pi.close();
    await auth.close();
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("Pi abort stops model work and retains committed partial text", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-pi-stop-"));
  const db = await openDatabase(dir);
  const auth = createAuth(db);
  const faux = fauxProvider({
    provider: "openai-codex",
    models: [{ id: "gpt-6.1-sol" }],
    tokensPerSecond: 10,
    tokenSize: { min: 2, max: 2 },
  });
  auth.models.setProvider(faux.provider);
    registerPlanAvailability(auth.models, (provider) => provider === "openai-codex");
  faux.setResponses([
    fauxAssistantMessage(
      "This reply should be stopped before it reaches the end of the sentence.",
    ),
  ]);
  const pi = await createPi(join(dir, "pi.sqlite"), auth);
  const controller = new AbortController();
  let text = "";
  try {
    await pi.run({
      text: "Stop this test reply.",
      requestId: randomUUID(),
      signal: controller.signal,
      onText: (value) => {
        text = value;
        controller.abort();
      },
    });
    assert(controller.signal.aborted);
    assert(text.length > 0);
    assert(text.length < 70);
  } finally {
    await pi.close();
    await auth.close();
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
