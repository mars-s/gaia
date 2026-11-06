import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { Snapshot, Event } from "../../packages/protocol/index.ts";
import { createAuth } from "./auth.ts";
import { createPi, type ChatAdapter } from "./pi.ts";
import { createChatServer, openDatabase } from "./server.ts";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture(small = false, realEffort = false) {
  const dir = await mkdtemp(join(tmpdir(), "gaia-controls-"));
  const db = await openDatabase(dir);
  const auth = createAuth(db);
  const thinkingLevelMap = realEffort
    ? auth.models.getModel("openai-codex", "gpt-6.1-sol")?.thinkingLevelMap
    : undefined;
  const faux = fauxProvider({
    provider: "openai-codex",
    models: [
      {
        id: "gpt-6.1-sol",
        reasoning: true,
        input: ["text", "image"],
      },
      { id: "test-second", name: "Second test model" },
    ],
    tokensPerSecond: 100000,
  });
  if (realEffort) faux.models[0].thinkingLevelMap = thinkingLevelMap;
  auth.models.setProvider(faux.provider);
    auth.planAvailability.connectedProviders = () => new Set(["openai-codex"]);
  const open = () =>
    createPi(
      join(dir, "pi.sqlite"),
      auth,
      [],
      small ? { compaction: { enabled: false, keepRecentTokens: 1 } } : {},
    );
  const pi = await open();
  const run = (text: string, adapter = pi) =>
    adapter.run({
      text,
      requestId: randomUUID(),
      onText() {},
      signal: new AbortController().signal,
    });
  const seed = async () => {
    faux.setResponses([
      fauxAssistantMessage("First answer."),
      fauxAssistantMessage("Second answer."),
    ]);
    await run("Remember eucalyptus.");
    await run("Keep this recent turn.");
  };
  return {
    dir,
    db,
    auth,
    faux,
    pi,
    open,
    run,
    seed,
    async close(adapter = pi) {
      await adapter.close();
      await auth.close();
      db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("registered OpenAI selection reaches the actual provider and persists with context on reopen", async () => {
  const f = await fixture();
  let pi = f.pi;
  try {
    assert.equal(pi.controls?.().modelId, "gpt-6.1-sol");
    assert.deepEqual(
      pi.controls?.().models.map((m) => m.id),
      ["gpt-6.1-sol", "test-second"],
    );
    const observer = new DatabaseSync(join(f.dir, "pi.sqlite"), {
      readOnly: true,
    });
    try {
      const version = observer.prepare("PRAGMA data_version").get();
      await assert.rejects(pi.configure?.("unregistered") ?? Promise.resolve());
      assert.deepEqual(
        observer.prepare("PRAGMA data_version").get(),
        version,
        "invalid selection must not write Pi configuration",
      );
    } finally {
      observer.close();
    }
    assert.equal(pi.controls?.().modelId, "gpt-6.1-sol");
    await pi.configure?.("test-second");
    f.faux.setResponses([
      (context, _options, _state, model) => {
        assert.equal(model.id, "test-second");
        assert.equal(model.provider, "openai-codex");
        return fauxAssistantMessage("Selection applied.");
      },
    ]);
    await f.run("Remember banksia.");
    await pi.close();
    pi = await f.open();
    assert.equal(pi.controls?.().modelId, "test-second");
    await assert.rejects(
      pi.configure?.("anthropic/claude") ?? Promise.resolve(),
    );
    f.faux.setResponses([
      (context, _options, _state, model) => {
        assert.equal(model.id, "test-second");
        assert.match(JSON.stringify(context.messages), /banksia/);
        return fauxAssistantMessage("Context retained.");
      },
    ]);
    await f.run("Recall it.", pi);
  } finally {
    await f.close(pi);
  }
});

test("effort capabilities come from Pi metadata, reach provider options and persist after reopen", async () => {
  const f = await fixture();
  let pi = f.pi;
  try {
    assert.deepEqual(pi.controls?.().models[0]?.capabilities, {
      images: true,
      thinkingLevels: ["off", "minimal", "low", "medium", "high"],
    });
    await pi.configure?.("gpt-6.1-sol", "high");
    const response = (
      _context: unknown,
      options: { reasoning?: string } | undefined,
    ) => {
      assert.equal(options?.reasoning, "high");
      return fauxAssistantMessage("High effort reached provider.");
    };
    f.faux.setResponses([response]);
    await f.run("Use the selected effort.");
    await pi.close();
    pi = await f.open();
    assert.equal(pi.controls?.().thinkingLevel, "high");
    f.faux.setResponses([response]);
    await f.run("Again after restart.", pi);
    await assert.rejects(
      pi.configure?.("gpt-6.1-sol", "max") ?? Promise.resolve(),
      /support/,
    );
    await assert.rejects(
      pi.configure?.("test-second", "high") ?? Promise.resolve(),
      /support/,
    );
    assert.equal(pi.controls?.().thinkingLevel, "high");
    await pi.configure?.("test-second");
    assert.equal(pi.controls?.().thinkingLevel, "off");
    f.faux.setResponses([
      (_context, options) => {
        assert.equal(options?.reasoning, undefined);
        return fauxAssistantMessage("Plain model.");
      },
    ]);
    await f.run("No reasoning supported.", pi);
  } finally {
    await f.close(pi);
  }
});

test("the installed Sol catalogue defaults to medium and exposes one stop per provider effort", async () => {
  const f = await fixture(false, true);
  let pi = f.pi;
  try {
    assert.equal(pi.controls?.().thinkingLevel, "medium");
    assert.deepEqual(pi.controls?.().models[0]?.capabilities?.thinkingLevels, [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    await assert.rejects(
      pi.configure?.("gpt-6.1-sol", "minimal") ?? Promise.resolve(),
      /support/,
    );
    assert.equal(pi.controls?.().thinkingLevel, "medium");
    await pi.configure?.("gpt-6.1-sol", "low");
    f.faux.setResponses([
      (_context, options) => {
        assert.equal(options?.reasoning, "low");
        return fauxAssistantMessage("One real low effort.");
      },
    ]);
    await f.run("Use low effort.");
    await pi.close();
    pi = await f.open();
    assert.equal(pi.controls?.().thinkingLevel, "low");
  } finally {
    await f.close(pi);
  }
});

test("production compaction policy truthfully reports no-op without a provider request", async () => {
  const f = await fixture();
  try {
    await f.seed();
    const calls = f.faux.state.callCount;
    assert.equal(await f.pi.compact?.(new AbortController().signal), "noop");
    assert.equal(f.faux.state.callCount, calls);
  } finally {
    await f.close();
  }
});

test("manual compaction places a real durable summary used by the next turn and after reopen", async () => {
  const f = await fixture(true);
  let pi = f.pi;
  try {
    await f.seed();
    f.faux.setResponses([
      (context) => {
        assert.match(JSON.stringify(context.messages), /eucalyptus/);
        return fauxAssistantMessage("Checkpoint summary preserves eucalyptus.");
      },
    ]);
    assert.equal(await pi.compact?.(new AbortController().signal), "done");
    await pi.close();
    pi = await f.open();
    f.faux.setResponses([
      (context) => {
        assert.match(
          JSON.stringify(context.messages),
          /<summary>.*Checkpoint summary preserves eucalyptus/s,
        );
        return fauxAssistantMessage("Summary survived reopen.");
      },
    ]);
    await f.run("Continue.", pi);
  } finally {
    await f.close(pi);
  }
});

test("real compaction failure and cancellation settle without placing a false summary", async () => {
  const f = await fixture(true);
  try {
    await f.seed();
    f.faux.setResponses([
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "private test detail",
      }),
    ]);
    await assert.rejects(
      f.pi.compact?.(new AbortController().signal) ?? Promise.resolve(),
      /Compaction failed/,
    );
    const started = deferred();
    const aborted = deferred();
    f.faux.setResponses([
      async (_context, options) => {
        started.resolve();
        assert(options?.signal);
        if (!options.signal.aborted)
          await new Promise<void>((resolve) =>
            options.signal?.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          );
        aborted.resolve();
        return fauxAssistantMessage("", { stopReason: "aborted" });
      },
    ]);
    const controller = new AbortController();
    const result = f.pi.compact?.(controller.signal);
    assert(result);
    const rejected = assert.rejects(result);
    await started.promise;
    controller.abort();
    await rejected;
    await aborted.promise;
    f.faux.setResponses([
      (context) => {
        assert.match(JSON.stringify(context.messages), /eucalyptus/);
        assert(!JSON.stringify(context.messages).includes("<summary>"));
        return fauxAssistantMessage("Original context retained.");
      },
    ]);
    await f.run("Continue after cancellation.");
  } finally {
    await f.close();
  }
});

async function serve(
  f: Awaited<ReturnType<typeof fixture>>,
  adapter: ChatAdapter = f.pi,
) {
  const origins: string[] = [];
  const app = createChatServer({
    db: f.db,
    adapter,
    auth: {
      status: () => ({ kind: "connected", model: "gpt-6.1-sol" }),
      connect() {},
      reply() {},
      async close() {},
    },
    origins,
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  origins.push(base);
  const request = (
    path: string,
    input?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + "/api/v1/" + path, {
      method: input === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...headers },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
  const state = async () =>
    Snapshot.parse(await (await request("state")).json());
  const settled = async () => {
    for (let n = 0; n < 200; n++) {
      const value = await state();
      if (value.thread.run.kind !== "running") return value;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Operation did not settle.");
  };
  return { app, request, state, settled };
}

test("HTTP controls validate safely, stream status, preserve visible history and reject overlapping work", async () => {
  const f = await fixture(true);
  const live = await serve(f);
  try {
    for (const [path, input] of [
      ["model", {}],
      ["model", { modelId: "test-second", extra: 1 }],
      ["model", { modelId: "unknown" }],
      ["compact", { extra: 1 }],
    ] satisfies [string, unknown][]) {
      assert.equal((await live.request(path, input)).status, 400);
    }
    for (const path of ["model", "compact"]) {
      const input = path === "model" ? { modelId: "test-second" } : {};
      assert.equal(
        (await live.request(path, input, { origin: "https://evil.example" }))
          .status,
        403,
      );
      assert.equal(
        (await live.request(path, input, { "sec-fetch-site": "cross-site" }))
          .status,
        403,
      );
      assert.equal(
        (await live.request(path, input, { "Content-Type": "text/plain" }))
          .status,
        415,
      );
    }
    assert.equal(
      (await live.request("model", { modelId: "test-second" })).status,
      202,
    );
    assert.equal((await live.state()).chat?.modelId, "test-second");
    f.faux.setResponses([
      fauxAssistantMessage("A visible answer."),
      fauxAssistantMessage("A second visible answer."),
    ]);
    for (const text of ["Remember eucalyptus.", "Recent turn."]) {
      await live.request("messages", { text, requestId: randomUUID() });
      await live.settled();
    }
    const history = (await live.state()).thread.messages;
    const started = deferred();
    const release = deferred();
    f.faux.setResponses([
      async () => {
        started.resolve();
        await release.promise;
        return fauxAssistantMessage("Real HTTP summary.");
      },
    ]);
    const response = await live.request("compact", {});
    assert.equal(response.status, 202);
    const running = Snapshot.parse(await response.json());
    assert.equal(running.thread.run.kind, "running");
    assert.equal(running.chat?.compaction.kind, "running");
    await started.promise;
    for (const [path, input] of [
      ["messages", { text: "conflict", requestId: randomUUID() }],
      ["retry", {}],
      ["model", { modelId: "gpt-6.1-sol" }],
      ["compact", {}],
    ] satisfies [string, unknown][]) {
      assert.equal((await live.request(path, input)).status, 409);
    }
    const events = await live.request("events");
    const reader = events.body?.getReader();
    assert(reader);
    const first = await reader.read();
    const line = new TextDecoder().decode(first.value).split("\n")[0];
    assert(line);
    assert.equal(
      Event.parse(JSON.parse(line.slice(6))).data.chat?.compaction.kind,
      "running",
    );
    release.resolve();
    const done = await live.settled();
    assert.equal(done.chat?.compaction.kind, "done");
    assert.deepEqual(done.thread.messages, history);
    await reader.cancel();
    await live.request("compact", {});
    const noop = await live.settled();
    assert.equal(noop.chat?.compaction.kind, "noop");
    assert.deepEqual(noop.thread.messages, history);
    f.faux.setResponses([fauxAssistantMessage("More context.")]);
    await live.request("messages", {
      text: "New input.",
      requestId: randomUUID(),
    });
    const expandedHistory = (await live.settled()).thread.messages;
    f.faux.setResponses([
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "private detail",
      }),
    ]);
    await live.request("compact", {});
    const failed = await live.settled();
    assert.equal(failed.chat?.compaction.kind, "error");
    assert(!JSON.stringify(failed).includes("private detail"));
    assert.deepEqual(failed.thread.messages, expandedHistory);
  } finally {
    await live.app.close();
    await f.auth.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("HTTP retry restores the message effort after selection changes and refuses unsupported levels", async () => {
  const f = await fixture();
  const live = await serve(f);
  try {
    assert.equal(
      (
        await live.request("model", {
          modelId: "test-second",
          thinkingLevel: "high",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await live.request("model", {
          modelId: "gpt-6.1-sol",
          thinkingLevel: "high",
        })
      ).status,
      202,
    );
    f.faux.setResponses([fauxAssistantMessage("", { stopReason: "error" })]);
    await live.request("messages", {
      text: "Keep this selection",
      requestId: randomUUID(),
    });
    const failed = await live.settled();
    assert.equal(failed.thread.run.kind, "error");
    assert.equal(failed.thread.messages[0]?.selection?.thinkingLevel, "high");
    await live.request("model", { modelId: "test-second" });
    f.faux.setResponses([
      (_context, options, _state, model) => {
        assert.equal(model.id, "gpt-6.1-sol");
        assert.equal(options?.reasoning, "high");
        return fauxAssistantMessage("Retry used retained selection.");
      },
    ]);
    assert.equal((await live.request("retry", {})).status, 202);
    const retried = await live.settled();
    assert.equal(retried.thread.run.kind, "idle");
    assert.equal(
      retried.thread.messages.filter((m) => m.role === "user").length,
      1,
    );
  } finally {
    await live.app.close();
    await f.auth.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("model configuration reserves the operation before awaiting durable writes", async () => {
  const f = await fixture();
  const started = deferred();
  const release = deferred();
  const live = await serve(f, {
    ...f.pi,
    async configure(id) {
      started.resolve();
      await release.promise;
      await f.pi.configure?.(id);
    },
  });
  try {
    const configuring = live.request("model", { modelId: "test-second" });
    await started.promise;
    for (const [path, input] of [
      ["model", { modelId: "gpt-6.1-sol" }],
      ["compact", {}],
      ["messages", { text: "race", requestId: randomUUID() }],
    ] satisfies [string, unknown][]) {
      assert.equal((await live.request(path, input)).status, 409);
    }
    release.resolve();
    assert.equal((await configuring).status, 202);
    assert.equal((await live.state()).chat?.modelId, "test-second");
  } finally {
    release.resolve();
    await live.app.close();
    await f.auth.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("HTTP Stop and shutdown abort and join actual compaction before becoming idle or closing", async () => {
  for (const action of ["stop", "close"]) {
    const f = await fixture(true);
    await f.seed();
    const live = await serve(f);
    let closed = false;
    try {
      const started = deferred();
      const aborted = deferred();
      const release = deferred();
      f.faux.setResponses([
        async (_context, options) => {
          started.resolve();
          assert(options?.signal);
          if (!options.signal.aborted)
            await new Promise<void>((resolve) =>
              options.signal?.addEventListener("abort", () => resolve(), {
                once: true,
              }),
            );
          aborted.resolve();
          await release.promise;
          return fauxAssistantMessage("", { stopReason: "aborted" });
        },
      ]);
      const history = (await live.state()).thread.messages;
      await live.request("compact", {});
      await started.promise;
      let closing: Promise<void> | undefined;
      if (action === "stop")
        assert.equal((await live.request("stop", {})).status, 202);
      else closing = live.app.close();
      await aborted.promise;
      assert.equal(
        live.app.snapshot().thread.run.kind,
        "running",
        "drain must still wait while provider is aborting",
      );
      assert.equal(live.app.snapshot().chat?.compaction.kind, "running");
      release.resolve();
      if (closing) {
        await closing;
        closed = true;
      } else {
        const state = await live.settled();
        assert.equal(state.thread.run.kind, "idle");
        assert.equal(state.chat?.compaction.kind, "error");
        assert.equal(state.chat?.compaction.message, "Compaction stopped.");
        assert.deepEqual(state.thread.messages, history);
      }
    } finally {
      if (!closed) await live.app.close();
      await f.auth.close();
      await rm(f.dir, { recursive: true, force: true });
    }
  }
});
