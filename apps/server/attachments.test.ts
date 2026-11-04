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
import { crc32, deflateSync } from "node:zlib";
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
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
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
  const request = (
    path: string,
    input?: unknown,
    headers = {},
    signal?: AbortSignal,
  ) =>
    fetch(base + "/api/v1/" + path, {
      method: input === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...headers },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      signal,
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

function image(width: number, height: number, padding = 0) {
  const chunk = (type: string, value: Buffer) => {
    const content = Buffer.concat([Buffer.from(type), value]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(value.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(content));
    return Buffer.concat([length, content, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++)
      pixels[row * (width * 3 + 1) + column * 3 + 1] = 255;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    ...(padding ? [chunk("raWd", Buffer.alloc(padding))] : []),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("real image decoding refuses corrupt payloads and prepares dimensions and byte limits before storage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-images-prepared-"));
  const f = await fixture(dir);
  try {
    const corrupt =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jSioAAAAASUVORK5CYII=";
    const invalid = await f.request("attachments", {
      ...upload(),
      data: corrupt,
    });
    assert.equal(invalid.status, 400);
    assert.match(JSON.stringify(await invalid.json()), /could not be decoded/);
    assert.deepEqual(await readdir(join(dir, "attachments")), []);
    const wide = { ...upload(), data: image(2400, 1).toString("base64") };
    const saved = Attachment.parse(
      await (await f.request("attachments", wide)).json(),
    );
    const download = await f.request(`attachments/${saved.id}`);
    const prepared = Buffer.from(await download.arrayBuffer());
    assert.equal(prepared.readUInt32BE(16), 2000);
    assert.equal(prepared.readUInt32BE(20), 1);
    assert.deepEqual(
      await (await f.request("attachments", wide)).json(),
      saved,
    );
    const padded = {
      ...upload(),
      data: image(1, 1, 4 * 1024 * 1024).toString("base64"),
    };
    const reduced = Attachment.parse(
      await (await f.request("attachments", padded)).json(),
    );
    assert(
      reduced.size < 1024,
      "Prepared pixels must not retain the oversized ancillary chunk",
    );
    assert.deepEqual(
      await (await f.request("attachments", padded)).json(),
      reduced,
    );
    const bomb = image(1, 1);
    bomb.writeUInt32BE(100000, 16);
    bomb.writeUInt32BE(100000, 20);
    const refused = await f.request("attachments", {
      ...upload(),
      data: bomb.toString("base64"),
    });
    assert.equal(refused.status, 400);
    assert.match(JSON.stringify(await refused.json()), /50 megapixels/);
    assert.equal(f.faux.state.callCount, 0);
  } finally {
    await f.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("cancelled upload preparation is drained and a captured interrupted control operation reopens without retrying old chat", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-image-drain-"));
  const backup = await mkdtemp(join(tmpdir(), "gaia-image-drain-backup-"));
  const f = await fixture(dir);
  let closed = false;
  let restored: Awaited<ReturnType<typeof fixture>> | undefined;
  const stream = await f.request("events");
  const reader = stream.body?.getReader();
  assert(reader);
  try {
    f.faux.setResponses([fauxAssistantMessage("Existing reply")]);
    await f.request("messages", {
      text: "Existing message",
      requestId: randomUUID(),
    });
    const retained = (await f.settle()).thread.messages;
    const controller = new AbortController();
    const result = f
      .request(
        "attachments",
        { ...upload(), data: image(4000, 3000).toString("base64") },
        {},
        controller.signal,
      )
      .then(
        (response) => ({ kind: "response", response }),
        () => ({ kind: "cancelled" }),
      );
    let content = "";
    const decoder = new TextDecoder();
    while (true) {
      const next = await reader.read();
      assert(!next.done);
      content += decoder.decode(next.value, { stream: true });
      const frames = content.split("\n\n");
      content = frames.pop() ?? "";
      if (
        frames.some((frame) => {
          const snapshot = Snapshot.parse(JSON.parse(frame.slice(6)).data);
          return (
            snapshot.thread.run.kind === "running" &&
            snapshot.thread.run.operation === "upload"
          );
        })
      )
        break;
    }
    f.db.exec(
      `VACUUM INTO '${join(backup, "gaia.sqlite").replaceAll("'", "''")}'`,
    );
    controller.abort();
    assert.equal((await result).kind, "cancelled");
    await reader.cancel();
    await f.app.close();
    closed = true;
    assert.deepEqual(await readdir(join(dir, "attachments")), []);
    restored = await fixture(backup);
    const state = await restored.state();
    assert.equal(state.thread.run.kind, "idle");
    assert.deepEqual(state.thread.messages, retained);
    assert.equal(restored.faux.state.callCount, 0);
  } finally {
    await reader.cancel().catch(() => {});
    if (!closed) await f.app.close();
    if (restored) await restored.app.close();
    await rm(dir, { recursive: true, force: true });
    await rm(backup, { recursive: true, force: true });
  }
});

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
