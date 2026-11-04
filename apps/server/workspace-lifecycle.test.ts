import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { deferred, workspaceFixture } from "./testing/workspace.ts";

test(
  "area Stop joins cancellation and later model changes preserve its retry state",
  { timeout: 10000 },
  async (t) => {
    const f = await workspaceFixture(t);
    const { first, second } = await f.confirm();
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
    await f.request(`areas/${first}/messages`, {
      text: "Retained stopped area input",
      requestId: randomUUID(),
    });
    await started.promise;
    const stopping = f.request(`areas/${first}/stop`, {});
    await aborted.promise;
    assert.equal(
      (
        await f.request(`areas/${second}/messages`, {
          text: "Still blocked",
          requestId: randomUUID(),
        })
      ).status,
      409,
    );
    release.resolve();
    assert.equal((await stopping).status, 202);
    const stopped = (await f.area(first)).thread;
    assert.equal(stopped.run.kind, "stopped");
    await f.request(`areas/${first}/model`, { modelId: "area-second" });
    assert.deepEqual((await f.area(first)).thread, stopped);
  },
);

test("area model configuration reserves global admission before awaiting its durable change", async (t) => {
  const f = await workspaceFixture(t);
  const { first, second } = await f.confirm();
  const workspace = f.pi.workspace;
  assert(workspace);
  const configure = workspace.configure;
  const started = deferred();
  const release = deferred();
  workspace.configure = async (...input) => {
    started.resolve();
    await release.promise;
    await configure(...input);
  };
  const configuring = f.request(`areas/${first}/model`, {
    modelId: "area-second",
    thinkingLevel: "high",
  });
  await started.promise;
  assert.equal(
    (
      await f.request("messages", {
        text: "Home conflict",
        requestId: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal((await f.request(`areas/${second}/compact`, {})).status, 409);
  release.resolve();
  assert.equal((await configuring).status, 202);
  assert.equal((await f.area(first)).chat.modelId, "area-second");
  assert.equal((await f.area(second)).chat.modelId, "gpt-6.1-sol");
  assert.equal(f.faux.state.callCount, 0);
});

test("area compaction uses real Pi summary, keeps raw displayed history and cannot change Home or other areas", async (t) => {
  const f = await workspaceFixture(t);
  const { first, second } = await f.confirm();
  assert.equal((await f.request(`areas/${second}/compact`, {})).status, 202);
  await f.settled(second);
  assert.equal((await f.area(second)).chat.compaction.kind, "noop");
  assert.equal(f.faux.state.callCount, 0);
  f.faux.setResponses([
    fauxAssistantMessage("First area answer"),
    fauxAssistantMessage("Recent area answer"),
  ]);
  for (const text of ["AREA_COMPACTION_MARKER", "Recent context"]) {
    await f.request(`areas/${first}/messages`, {
      text,
      requestId: randomUUID(),
    });
    await f.settled(first);
  }
  const before = (await f.area(first)).thread.messages;
  const home = await f.home();
  const secondBefore = await f.area(second);
  f.faux.setResponses([
    (context) => {
      assert.match(JSON.stringify(context), /AREA_COMPACTION_MARKER/);
      return fauxAssistantMessage("Actual durable area compaction summary");
    },
  ]);
  await f.request(`areas/${first}/compact`, {});
  await f.settled(first);
  assert.equal((await f.area(first)).chat.compaction.kind, "done");
  assert.deepEqual((await f.area(first)).thread.messages, before);
  assert.deepEqual(await f.home(), home);
  assert.deepEqual(await f.area(second), secondBefore);
  await f.reopen();
  assert.equal(f.faux.state.callCount, 3);
  f.faux.setResponses([
    (context) => {
      assert.match(
        JSON.stringify(context),
        /<summary>.*Actual durable area compaction summary/s,
      );
      return fauxAssistantMessage("Resumed with actual summary");
    },
  ]);
  await f.request(`areas/${first}/messages`, {
    text: "Continue explicitly",
    requestId: randomUUID(),
  });
  assert.equal(
    (await f.settled(first)).thread.messages.at(-1)?.text,
    "Resumed with actual summary",
  );
});

for (const operation of ["reply", "compact"] as const)
  test(
    `direct area ${operation} cancellation rejects overlap and joins on shutdown`,
    { timeout: 10000 },
    async (t) => {
      const f = await workspaceFixture(t);
      const { first, second } = await f.confirm();
      if (operation === "compact") {
        f.faux.setResponses([
          fauxAssistantMessage("Earlier answer"),
          fauxAssistantMessage("Recent answer"),
        ]);
        for (const text of ["Earlier context", "Recent context"]) {
          await f.request(`areas/${first}/messages`, {
            text,
            requestId: randomUUID(),
          });
          await f.settled(first);
        }
      }
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
      if (operation === "reply")
        await f.request(`areas/${first}/messages`, {
          text: "Cancellable request",
          requestId: randomUUID(),
        });
      else await f.request(`areas/${first}/compact`, {});
      await started.promise;
      assert.equal(
        (
          await f.request("messages", {
            text: "Home conflict",
            requestId: randomUUID(),
          })
        ).status,
        409,
      );
      assert.equal((await f.request("stop", {})).status, 409);
      assert.equal((await f.request(`areas/${second}/stop`, {})).status, 409);
      assert.equal(
        (await f.request(`areas/${second}/model`, { modelId: "area-second" }))
          .status,
        409,
      );
      let closed = false;
      const shutdown = f.close().then(() => {
        closed = true;
      });
      await aborted.promise;
      assert.equal(closed, false);
      release.resolve();
      await shutdown;
      assert(closed);
    },
  );

test(
  "reopening captured area compaction preserves history and exposes no unrelated reply error",
  { timeout: 10000 },
  async (t) => {
    const f = await workspaceFixture(t);
    const { first } = await f.confirm();
    f.faux.setResponses([
      fauxAssistantMessage("First retained answer"),
      fauxAssistantMessage("Recent retained answer"),
    ]);
    for (const text of ["Synthetic old context", "Synthetic recent context"]) {
      await f.request(`areas/${first}/messages`, {
        text,
        requestId: randomUUID(),
      });
      await f.settled(first);
    }
    const messages = (await f.area(first)).thread.messages;
    const started = deferred();
    f.faux.setResponses([
      async (_context, options) => {
        assert(options?.signal);
        started.resolve();
        if (!options.signal.aborted)
          await new Promise<void>((resolve) =>
            options.signal?.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          );
        return fauxAssistantMessage("", { stopReason: "aborted" });
      },
    ]);
    await f.request(`areas/${first}/compact`, {});
    await started.promise;
    const captured = await mkdtemp(join(tmpdir(), "gaia-compact-captured-"));
    const observer = new DatabaseSync(join(f.dir, "pi.sqlite"));
    try {
      observer.exec(
        `VACUUM INTO '${join(captured, "pi.sqlite").replaceAll("'", "''")}'`,
      );
    } finally {
      observer.close();
    }
    f.db.exec(
      `VACUUM INTO '${join(captured, "gaia.sqlite").replaceAll("'", "''")}'`,
    );
    await f.close();
    const restored = await workspaceFixture(t, true, captured);
    const snapshot = await restored.area(first);
    assert.equal(snapshot.thread.run.kind, "idle");
    assert.equal(snapshot.chat.compaction.kind, "error");
    assert.deepEqual(snapshot.thread.messages, messages);
    assert.equal(restored.faux.state.callCount, 0);
  },
);

for (const routed of [false, true])
  test(
    `reopening captured interrupted ${routed ? "routed Home and area" : "area"} tasks makes zero provider calls and preserves retry target`,
    { timeout: 10000 },
    async (t) => {
      const f = await workspaceFixture(t);
      const { first, second } = await f.confirm();
      await f.request(`areas/${first}/model`, {
        modelId: "area-second",
        thinkingLevel: "high",
      });
      const started = deferred();
      f.faux.setResponses([
        ...(routed
          ? [
              fauxAssistantMessage(
                fauxToolCall("route_to_area", {
                  areaId: first,
                  text: "INTERRUPTED_AREA_MARKER",
                }),
                { stopReason: "toolUse" },
              ),
            ]
          : []),
        async (_context, options) => {
          started.resolve();
          assert(options?.signal);
          if (!options.signal.aborted)
            await new Promise<void>((resolve) =>
              options.signal?.addEventListener("abort", () => resolve(), {
                once: true,
              }),
            );
          return fauxAssistantMessage("", { stopReason: "aborted" });
        },
      ]);
      if (routed)
        await f.request("messages", {
          text: "Route synthetic interrupted work",
          requestId: randomUUID(),
        });
      else
        await f.request(`areas/${first}/messages`, {
          text: "INTERRUPTED_AREA_MARKER",
          requestId: randomUUID(),
        });
      await started.promise;
      const captured = await mkdtemp(join(tmpdir(), "gaia-area-captured-"));
      const observer = new DatabaseSync(join(f.dir, "pi.sqlite"));
      try {
        observer.exec(
          `VACUUM INTO '${join(captured, "pi.sqlite").replaceAll("'", "''")}'`,
        );
      } finally {
        observer.close();
      }
      const original = (await f.area(first)).thread.messages;
      const retainedUser = original.find((message) => message.role === "user");
      assert(retainedUser);
      f.db.prepare("DELETE FROM requests WHERE id=?").run(retainedUser.id);
      f.db.exec(
        `VACUUM INTO '${join(captured, "gaia.sqlite").replaceAll("'", "''")}'`,
      );
      await f.close();
      const restored = await workspaceFixture(t, true, captured);
      assert.equal(restored.faux.state.callCount, 0);
      assert.equal(restored.faux.state.deferredFetchCount, 0);
      assert.deepEqual(restored.faux.state.cancelledDeferred, []);
      assert.equal(
        (
          await restored.request("messages", {
            text: retainedUser.text,
            requestId: retainedUser.id,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await restored.request(`areas/${first}/messages`, {
            text: retainedUser.text,
            requestId: retainedUser.id,
          })
        ).status,
        200,
      );
      assert.equal(restored.faux.state.callCount, 0);
      assert.equal((await restored.area(first)).thread.run.kind, "error");
      assert.deepEqual((await restored.area(first)).thread.messages, original);
      assert.deepEqual((await restored.area(second)).thread.messages, []);
      if (routed)
        assert.equal((await restored.home()).thread.run.kind, "error");
      await restored.request(`areas/${first}/model`, { modelId: "text-only" });
      restored.faux.setResponses([
        (context, options, _state, model) => {
          assert.equal(model.id, "area-second");
          assert.equal(options?.reasoning, "high");
          assert.match(JSON.stringify(context), /INTERRUPTED_AREA_MARKER/);
          assert(
            !JSON.stringify(context).includes(
              "Route synthetic interrupted work",
            ),
          );
          return fauxAssistantMessage("Explicit retry in the correct area");
        },
      ]);
      assert.equal(
        (await restored.request(`areas/${first}/retry`, {})).status,
        202,
      );
      assert.equal(
        (await restored.settled(first)).thread.messages.at(-1)?.text,
        "Explicit retry in the correct area",
      );
      assert.equal(restored.faux.state.callCount, 1);
    },
  );
