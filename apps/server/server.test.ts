import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { Snapshot, Event } from "../../packages/protocol/index.ts";
import { createChatServer, openDatabase, type AuthService } from "./server.ts";
import type { ChatAdapter } from "./pi.ts";
const auth: AuthService = {
  status: () => ({ kind: "connected", model: "gpt-6.1-sol" }),
  connect() {},
  reply() {},
  async close() {},
};
// Deterministic test adapter is injected here only. The executable always opens Pi Durable.
const adapter: ChatAdapter = {
  async run({ text, onText, signal }) {
    if (text === "fail") throw new Error("secret-provider-detail");
    onText("Partial");
    if (text === "wait")
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
    else onText(`Test reply: ${text}`);
  },
  async close() {},
};
async function boot(dir: string, service = auth) {
  const db = await openDatabase(dir);
  const origins = ["http://localhost:4317"];
  const app = createChatServer({ db, adapter, auth: service, origins });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  origins.push(base);
  const request = (
    path: string,
    method = "GET",
    input: unknown = {},
    extra: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method,
      headers: {
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        ...extra,
      },
      ...(method === "POST" ? { body: JSON.stringify(input) } : {}),
    });
  return { app, request };
}
async function settled(request: Awaited<ReturnType<typeof boot>>["request"]) {
  for (let n = 0; n < 100; n++) {
    const response = await request("/api/v1/state");
    const state = Snapshot.parse(await response.json());
    if (state.thread.run.kind !== "running") return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Run did not settle");
}
test("HTTP chat persists through restart, validates inputs, rejects cross-origin writes and retries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-http-"));
  let live = await boot(dir);
  try {
    assert.equal((await live.request("/healthz")).status, 200);
    assert.equal((await settled(live.request)).chat, undefined);
    assert.equal(
      (await live.request("/api/v1/model", "POST", { modelId: "gpt-6.1-sol" }))
        .status,
      409,
    );
    assert.equal((await live.request("/api/v1/compact", "POST")).status, 409);
    assert.equal(
      (await live.request("/api/v1/messages", "POST", { text: "" })).status,
      400,
    );
    assert.equal(
      (
        await live.request(
          "/api/v1/messages",
          "POST",
          { text: "hello", requestId: randomUUID() },
          { origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await live.request(
          "/api/v1/messages",
          "POST",
          {},
          { "sec-fetch-site": "cross-site" },
        )
      ).status,
      403,
    );
    const requestId = randomUUID();
    assert.equal(
      (
        await live.request("/api/v1/messages", "POST", {
          text: "hello",
          requestId,
        })
      ).status,
      202,
    );
    let state = await settled(live.request);
    assert.equal(state.thread.messages.at(-1)?.text, "Test reply: hello");
    await live.request("/api/v1/messages", "POST", {
      text: "hello",
      requestId,
    });
    assert.equal((await settled(live.request)).thread.messages.length, 2);
    await live.app.close();
    live = await boot(dir);
    state = await settled(live.request);
    assert.equal(state.thread.messages[0]?.text, "hello");
    assert.equal(state.thread.messages.at(-1)?.text, "Test reply: hello");
    await live.request("/api/v1/retry", "POST");
    state = await settled(live.request);
    assert.equal(
      state.thread.messages.filter((m) => m.role === "user").length,
      1,
    );
    assert.equal(state.thread.messages.length, 3);
  } finally {
    await live.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("stop retains partial output, rejects overlapping runs, failure retains input and hides provider details", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-stop-"));
  const live = await boot(dir);
  try {
    await live.request("/api/v1/messages", "POST", {
      text: "wait",
      requestId: randomUUID(),
    });
    assert.equal(
      (
        await live.request("/api/v1/messages", "POST", {
          text: "overlap",
          requestId: randomUUID(),
        })
      ).status,
      409,
    );
    await live.request("/api/v1/stop", "POST");
    let state = await settled(live.request);
    assert.equal(state.thread.run.kind, "stopped");
    assert.equal(state.thread.messages.at(-1)?.text, "Partial");
    await live.request("/api/v1/messages", "POST", {
      text: "fail",
      requestId: randomUUID(),
    });
    state = await settled(live.request);
    assert.equal(state.thread.run.kind, "error");
    assert(state.thread.messages.some((m) => m.text === "fail"));
    assert(!JSON.stringify(state).includes("secret-provider-detail"));
  } finally {
    await live.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("SSE delivers validated snapshots and disconnected mode rejects model work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-stream-"));
  const live = await boot(dir, {
    ...auth,
    status: () => ({ kind: "disconnected", message: "Connect ChatGPT." }),
  });
  try {
    assert.equal(
      (
        await live.request("/api/v1/messages", "POST", {
          text: "hello",
          requestId: randomUUID(),
        })
      ).status,
      409,
    );
    const response = await live.request("/api/v1/events");
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    const reader = response.body?.getReader();
    assert(reader);
    const first = await reader.read();
    const line = new TextDecoder().decode(first.value).split("\n")[0];
    assert(line);
    const event = Event.parse(JSON.parse(line.slice(6)));
    assert.equal(event.data.connection.kind, "disconnected");
    await reader.cancel();
  } finally {
    await live.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("restart converts an unfinished saved run into an explicit recoverable error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-restart-"));
  const db = await openDatabase(dir);
  db.exec("CREATE TABLE chat (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  db.prepare("INSERT INTO chat VALUES(1,?)").run(
    JSON.stringify({
      version: 1,
      id: "local",
      messages: [
        {
          id: randomUUID(),
          role: "user",
          text: "Retain this input",
          createdAt: new Date().toISOString(),
        },
      ],
      run: { kind: "running", id: randomUUID() },
    }),
  );
  db.close();
  const live = await boot(dir);
  try {
    const state = await settled(live.request);
    assert.equal(state.thread.run.kind, "error");
    assert.equal(state.thread.messages[0]?.text, "Retain this input");
    await live.request("/api/v1/retry", "POST");
    assert.equal(
      (await settled(live.request)).thread.messages.at(-1)?.text,
      "Test reply: Retain this input",
    );
  } finally {
    await live.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("raw HTTP preserves split UTF-8 and malformed targets return 400 without crashing", async () => {
  const { createConnection } = await import("node:net");
  const dir = await mkdtemp(join(tmpdir(), "gaia-raw-"));
  const live = await boot(dir);
  const address = live.app.server.address();
  assert(address && typeof address !== "string");
  async function raw(parts: Buffer[]) {
    const socket = createConnection({
      host: "127.0.0.1",
      port: address && typeof address !== "string" ? address.port : 0,
    });
    await once(socket, "connect");
    const chunks: Buffer[] = [];
    socket.on("data", (chunk) => chunks.push(chunk));
    const ended = once(socket, "end");
    for (const part of parts) {
      socket.write(part);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await ended;
    return Buffer.concat(chunks).toString("utf8");
  }
  try {
    const payload = Buffer.from(
      JSON.stringify({ requestId: randomUUID(), text: "Hello 🌱 Gaia" }),
    );
    const split = payload.indexOf(Buffer.from("🌱")) + 2;
    const request = Buffer.from(
      `POST /api/v1/messages HTTP/1.1\r\nHost: 127.0.0.1:${address.port}\r\nContent-Type: application/json\r\nContent-Length: ${payload.length}\r\nConnection: close\r\n\r\n`,
    );
    const response = await raw([
      request,
      payload.subarray(0, split),
      payload.subarray(split),
    ]);
    assert.match(response, /HTTP\/1.1 202/);
    assert.equal(
      (await settled(live.request)).thread.messages[0]?.text,
      "Hello 🌱 Gaia",
    );
    const invalid = await raw([
      Buffer.from(
        `GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${address.port}\r\nConnection: close\r\n\r\n`,
      ),
    ]);
    assert.match(invalid, /HTTP\/1.1 400/);
    assert.equal((await live.request("/healthz")).status, 200);
  } finally {
    await live.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("disconnect during pending login returns a plain 409 without calling logout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-login-conflict-"));
  let logoutCalls = 0;
  const live = await boot(dir, {
    ...auth,
    status: () => ({ kind: "connecting", provider: "anthropic" }),
    async disconnect() {
      logoutCalls++;
      throw new Error("Finish signing in before disconnecting a plan.");
    },
  });
  try {
    const response = await live.request("/api/v1/auth/disconnect", "POST", {
      provider: "anthropic",
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "Finish signing in first.",
    });
    assert.equal(logoutCalls, 0);
  } finally {
    await live.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("disconnect store errors return a safe 503 and concurrent writes get 409", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-disconnect-lock-"));
  let release = () => {};
  let started = () => {};
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const live = await boot(dir, {
    ...auth,
    async disconnect() {
      started();
      await hold;
      throw new Error("synthetic private database detail");
    },
  });
  try {
    const disconnect = live.request("/api/v1/auth/disconnect", "POST", {
      provider: "anthropic",
    });
    await began;
    const send = await live.request("/api/v1/messages", "POST", {
      text: "must not start",
      requestId: randomUUID(),
    });
    assert.equal(send.status, 409);
    release();
    const result = await disconnect;
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), {
      error: "The plan could not be disconnected. Try again shortly.",
    });
    assert.equal((await settled(live.request)).thread.messages.length, 0);
  } finally {
    release();
    await live.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a second connect during pending login returns 409", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-second-connect-"));
  const live = await boot(dir, {
    ...auth,
    status: () => ({ kind: "connecting", provider: "openai-codex" }),
    connect() {
      assert.fail("must not start another login");
    },
  });
  try {
    const result = await live.request("/api/v1/auth/connect", "POST", {
      provider: "anthropic",
    });
    assert.equal(result.status, 409);
    assert.deepEqual(await result.json(), {
      error: "Finish signing in first.",
    });
  } finally {
    await live.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

import { experienceFixture } from "./testing/experiences.ts";
test("disconnect refuses active independent jobs", async (t) => {
  const f = await experienceFixture(t);
  assert(f.pi.experiences);
  f.pi.experiences.busy = async () => ({
    admissionOpen: true,
    jobs: 1,
    operations: 0,
  });
  const response = await f.request("auth/disconnect", {
    provider: "anthropic",
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Wait for active jobs to finish before disconnecting a plan.",
  });
});
