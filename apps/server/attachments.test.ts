import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import {
  Attachment,
  imageLimits,
} from "../../packages/protocol/attachments.ts";
import { Snapshot } from "../../packages/protocol/index.ts";
import { createAuth } from "./auth.ts";
import { createPi } from "./pi.ts";
import { createChatServer, openDatabase } from "./server.ts";
import { openAttachments } from "./attachments.ts";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jSioAAAAASUVORK5CYII=";
const upload = () => ({
  id: randomUUID(),
  name: "photo.png",
  mimeType: "image/png" as const,
  data: png,
});

async function fixture(dir: string) {
  const db = await openDatabase(dir);
  const auth = createAuth(db);
  const faux = fauxProvider({
    provider: "openai-codex",
    models: [
      { id: "gpt-6.1-sol", reasoning: true, input: ["text", "image"] },
      { id: "text-only", input: ["text"] },
    ],
    tokensPerSecond: 100000,
  });
  auth.models.setProvider(faux.provider);
  const pi = await createPi(join(dir, "pi.sqlite"), auth);
  const origins: string[] = [];
  let allowed = true;
  let connected = true;
  const app = createChatServer({
    db,
    adapter: pi,
    origins,
    allowWrite: async () => allowed,
    auth: {
      status: () =>
        connected
          ? { kind: "connected", model: "gpt-6.1-sol" }
          : { kind: "disconnected", message: "Connect" },
      connect() {},
      reply() {},
      async close() {
        await auth.close();
      },
    },
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  origins.push(base);
  const request = (path: string, input?: unknown, headers = {}) =>
    fetch(base + "/api/v1/" + path, {
      method: input === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...headers },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
  const state = async () =>
    Snapshot.parse(await (await request("state")).json());
  const settle = async () => {
    for (let n = 0; n < 200; n++) {
      const value = await state();
      if (value.thread.run.kind !== "running") return value;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Test run did not settle.");
  };
  return {
    db,
    faux,
    pi,
    app,
    request,
    settle,
    state,
    allow(value: boolean) {
      allowed = value;
    },
    connect(value: boolean) {
      connected = value;
    },
  };
}

test("image-only and mixed sends reach real Pi as image blocks, retain selection and retry after reopen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-images-"));
  let f = await fixture(dir);
  try {
    const schema = f.db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name",
      )
      .all();
    const input = upload();
    const saved = Attachment.parse(
      await (await f.request("attachments", input)).json(),
    );
    assert.equal(saved.size, Buffer.from(png, "base64").length);
    assert.equal(
      (await stat(join(dir, "attachments", `${input.id}.json`))).mode & 0o777,
      0o600,
    );
    await f.request("model", { modelId: "gpt-6.1-sol", thinkingLevel: "high" });
    let calls = 0;
    f.faux.setResponses([
      (context, options) => {
        calls++;
        assert.equal(options?.reasoning, "high");
        const content = context.messages.findLast(
          (m) => m.role === "user",
        )?.content;
        assert.deepEqual(content, [
          { type: "image", data: png, mimeType: "image/png" },
        ]);
        return fauxAssistantMessage("", { stopReason: "error" });
      },
    ]);
    const message = {
      text: "",
      attachments: [saved.id],
      requestId: randomUUID(),
    };
    const responses = await Promise.all([
      f.request("messages", message),
      f.request("messages", message),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 202]);
    const failed = await f.settle();
    assert.equal(calls, 1);
    assert.equal(failed.thread.run.kind, "error");
    assert.deepEqual(failed.thread.messages[0]?.attachments, [saved]);
    assert.equal(
      (await f.request("messages", { ...message, text: "Different" })).status,
      409,
    );
    assert.equal((await f.request("attachments", input)).status, 201);
    assert.equal((await readdir(join(dir, "attachments"))).length, 1);
    assert(!JSON.stringify(failed).includes(png));
    await f.app.close();
    f = await fixture(dir);
    assert.deepEqual((await f.state()).thread.messages, failed.thread.messages);
    assert.deepEqual(
      f.db
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name",
        )
        .all(),
      schema,
    );
    await f.request("model", { modelId: "text-only" });
    f.faux.setResponses([
      (context, options, _state, model) => {
        assert.equal(model.id, "gpt-6.1-sol");
        assert.equal(options?.reasoning, "high");
        assert(
          context.messages.some(
            (m) =>
              m.role === "user" &&
              Array.isArray(m.content) &&
              m.content.some((p) => p.type === "image" && p.data === png),
          ),
        );
        return fauxAssistantMessage("Retried the real image.");
      },
    ]);
    assert.equal((await f.request("retry", {})).status, 202);
    assert.equal((await f.settle()).thread.run.kind, "idle");
    f.faux.setResponses([
      (context) => {
        assert.deepEqual(
          context.messages.findLast((m) => m.role === "user")?.content,
          [
            { type: "text", text: "Describe this" },
            { type: "image", data: png, mimeType: "image/png" },
          ],
        );
        return fauxAssistantMessage("Mixed content received.");
      },
    ]);
    assert.equal(
      (
        await f.request("messages", {
          text: "Describe this",
          attachments: [saved.id],
          requestId: randomUUID(),
        })
      ).status,
      202,
    );
    assert.equal((await f.settle()).thread.run.kind, "idle");
    const download = await f.request(`attachments/${saved.id}`);
    assert.equal(download.headers.get("content-type"), "image/png");
    assert.deepEqual(
      Buffer.from(await download.arrayBuffer()),
      Buffer.from(png, "base64"),
    );
  } finally {
    await f.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("malformed, oversized, traversing, duplicate and unsupported images fail before storage or model submission", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-images-invalid-"));
  const f = await fixture(dir);
  try {
    const original = upload();
    for (const value of [
      { ...original, id: "../../outside" },
      { ...original, path: "/etc/passwd" },
      { ...original, mimeType: "image/svg+xml" },
      { ...original, mimeType: "image/jpeg" },
      { ...original, data: "not-base64" },
      { ...original, data: Buffer.from("plain text").toString("base64") },
      {
        ...original,
        data: Buffer.alloc(imageLimits.bytes + 1).toString("base64"),
      },
      { ...original, data: png.slice(0, -8) },
    ])
      assert.equal((await f.request("attachments", value)).status, 400);
    assert.equal((await readdir(dir)).includes("attachments"), false);
    assert.equal(
      (
        await f.request("attachments", original, {
          origin: "https://evil.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request("attachments", original, {
          "sec-fetch-site": "cross-site",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request("attachments", original, {
          "Content-Type": "text/plain",
        })
      ).status,
      415,
    );
    f.allow(false);
    assert.equal((await f.request("attachments", original)).status, 503);
    f.allow(true);
    f.connect(false);
    assert.equal((await f.request("attachments", original)).status, 409);
    f.connect(true);
    const saved = Attachment.parse(
      await (
        await f.request("attachments", {
          ...original,
          name: "../secret\\\\photo\\u0000.png",
        })
      ).json(),
    );
    assert(!/[\\/\p{Cc}\p{Cf}]/u.test(saved.name));
    for (const ids of [
      [randomUUID()],
      [saved.id, saved.id],
      Array.from({ length: 5 }, () => saved.id),
      ["/tmp/photo.png"],
    ])
      assert.equal(
        (
          await f.request("messages", {
            text: "",
            attachments: ids,
            requestId: randomUUID(),
          })
        ).status,
        400,
      );
    assert.equal(
      (await f.request("attachments", { ...original, name: "conflict.png" }))
        .status,
      400,
    );
    await f.request("model", { modelId: "text-only" });
    assert.equal((await f.request("attachments", upload())).status, 409);
    assert.equal(
      (
        await f.request("messages", {
          text: "A photo",
          attachments: [saved.id],
          requestId: randomUUID(),
        })
      ).status,
      409,
    );
    assert.equal(f.faux.state.callCount, 0);
    assert.equal(f.app.snapshot().thread.messages.length, 0);
    const path = join(dir, "attachments", `${saved.id}.json`);
    const content = await readFile(path);
    await rm(path);
    const outside = join(dir, "outside.json");
    await writeFile(outside, content);
    await symlink(outside, path);
    assert.throws(() => openAttachments(f.db).read(saved.id));
    await rm(path);
    await writeFile(path, "invalid");
    assert.equal((await f.request(`attachments/${saved.id}`)).status, 500);
  } finally {
    await f.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Stop and shutdown abort real image runs, retain references and reject concurrent uploads", async () => {
  for (const action of ["stop", "close"]) {
    const dir = await mkdtemp(join(tmpdir(), "gaia-images-stop-"));
    const f = await fixture(dir);
    let closed = false;
    try {
      const saved = Attachment.parse(
        await (await f.request("attachments", upload())).json(),
      );
      let started = () => {};
      const start = new Promise<void>((resolve) => {
        started = resolve;
      });
      let aborted = false;
      f.faux.setResponses([
        async (_context, options) => {
          started();
          await new Promise<void>((resolve) =>
            options?.signal?.addEventListener(
              "abort",
              () => {
                aborted = true;
                resolve();
              },
              { once: true },
            ),
          );
          return fauxAssistantMessage("", { stopReason: "aborted" });
        },
      ]);
      await f.request("messages", {
        text: "",
        attachments: [saved.id],
        requestId: randomUUID(),
      });
      await start;
      assert.equal((await f.request("attachments", upload())).status, 409);
      assert.equal(
        (await f.request("model", { modelId: "text-only" })).status,
        409,
      );
      if (action === "stop") {
        await f.request("stop", {});
        await f.settle();
      } else {
        await f.app.close();
        closed = true;
      }
      assert(aborted);
      assert.deepEqual(f.app.snapshot().thread.messages[0]?.attachments, [
        saved,
      ]);
    } finally {
      if (!closed) await f.app.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
});
