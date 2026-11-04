import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { Event, Snapshot } from "../packages/protocol/index.ts";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { createChatServer, openDatabase } from "../apps/server/server.ts";
export async function conformance(stage: string) {
  const { createChatServer: create, openDatabase: open } = (await import(
    pathToFileURL(join(stage, "apps/server/server.ts")).href
  )) as {
    createChatServer: typeof createChatServer;
    openDatabase: typeof openDatabase;
  };
  await mkdir(join(stage, ".scratch"), { recursive: true });
  const dir = await mkdtemp(join(stage, ".scratch/conformance-"));
  const origins: string[] = [];
  const app = create({
    db: await open(dir),
    auth: {
      status: () => ({ kind: "connected", model: "gpt-6.1-sol" }),
      connect() {},
      reply() {},
      async close() {},
    },
    adapter: {
      async run({ text, onText }) {
        onText(text);
      },
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
  try {
    assert.equal((await fetch(base + "/healthz")).status, 200);
    const response = await fetch(base + "/api/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "protocol-conformance",
        requestId: randomUUID(),
      }),
    });
    assert.equal(response.status, 202);
    Snapshot.parse(await response.json());
    await new Promise((resolve) => setTimeout(resolve, 30));
    const state = Snapshot.parse(
      await (await fetch(base + "/api/v1/state")).json(),
    );
    assert.equal(state.thread.messages.at(-1)?.text, "protocol-conformance");
    assert.equal(state.thread.run.kind, "idle");
    const events = await fetch(base + "/api/v1/events", {
      signal: AbortSignal.timeout(3000),
    });
    const reader = events.body?.getReader();
    assert(reader);
    const first = await reader.read();
    Event.parse(
      JSON.parse(
        new TextDecoder().decode(first.value).split("\n")[0]?.slice(6) ?? "",
      ),
    );
    await reader.cancel();
    assert.equal(
      (
        await fetch(base + "/api/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://evil.example",
          },
          body: "{}",
        })
      ).status,
      403,
    );
  } finally {
    await app.close();
    await rm(dir, { force: true, recursive: true });
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await conformance(resolve(process.argv[2] ?? "."));
  process.stdout.write("Protocol conformance passed\n");
}
