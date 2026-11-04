import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { request as rawRequest } from "node:http";
import { test } from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { Attachment } from "../../packages/protocol/attachments.ts";
import { Thread } from "../../packages/protocol/index.ts";
import {
  WorkspaceProposal,
  WorkspaceState,
} from "../../packages/sdk/workspace.ts";
import { openOwnerProfile } from "./profile.ts";
import { deferred, plan, png, workspaceFixture } from "./testing/workspace.ts";

test("area controls share the installed Sol effort policy and persist independent selection", async (t) => {
  const f = await workspaceFixture(t, true, undefined, true);
  const { first } = await f.confirm();
  const initial = await f.area(first);
  assert.equal(initial.chat.thinkingLevel, "medium");
  assert.deepEqual(
    initial.chat.models.find((model) => model.id === "gpt-6.1-sol")
      ?.capabilities?.thinkingLevels,
    ["low", "medium", "high", "xhigh", "max"],
  );
  assert.equal(
    (
      await f.request(`areas/${first}/model`, {
        modelId: "gpt-6.1-sol",
        thinkingLevel: "minimal",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request(`areas/${first}/model`, {
        modelId: "gpt-6.1-sol",
        thinkingLevel: "max",
      })
    ).status,
    202,
  );
  f.faux.setResponses([
    (_context, options) => {
      assert.equal(options?.reasoning, "max");
      return fauxAssistantMessage("Actual area effort selection.");
    },
  ]);
  await f.request(`areas/${first}/messages`, {
    requestId: randomUUID(),
    text: "Use this area's selected effort.",
  });
  await f.settled(first);
  await f.reopen();
  assert.equal((await f.area(first)).chat.thinkingLevel, "max");
  assert.equal((await f.home()).chat?.thinkingLevel, "medium");
});

test(
  "workspace HTTP exact, stale and concurrent confirmation preserves Home, skipped profile, credentials and schema",
  { timeout: 10000 },
  async (t) => {
    const f = await workspaceFixture(t);
    assert(openOwnerProfile(f.db).action("skip"));
    const profile = await readFile(join(f.dir, "owner-profile.json"));
    const credential = {
      type: "oauth" as const,
      access: "synthetic-access",
      refresh: "synthetic-refresh",
      expires: Date.now() + 600000,
    };
    f.faux.setResponses([fauxAssistantMessage("Private Home answer")]);
    await f.request("messages", {
      text: "PRIVATE_HOME_MARKER",
      requestId: randomUUID(),
    });
    await f.settled();
    await f.auth.store.modify("openai-codex", async () => credential);
    const home = await f.home();
    const schema = f.schema();
    const gaiaSchema = f.db
      .prepare("SELECT name, sql FROM sqlite_master ORDER BY name")
      .all();
    assert.deepEqual(
      WorkspaceState.parse(await (await f.request("workspace")).json()),
      { kind: "empty" },
    );
    const first = WorkspaceProposal.parse(
      await (await f.request("workspace/propose", plan)).json(),
    );
    const next = WorkspaceProposal.parse(
      await (await f.request("workspace/propose", plan)).json(),
    );
    assert.equal(next.revision, 2);
    assert.equal(
      (
        await f.request("workspace/confirm", {
          proposalId: first.proposalId,
          revision: first.revision,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.request("workspace/confirm", {
          proposalId: next.proposalId,
          revision: 1,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.request("workspace/confirm", {
          proposalId: next.proposalId,
          revision: next.revision,
          approved: true,
        })
      ).status,
      400,
    );
    if (next.workspace.kind !== "multi") throw new Error("Expected multi.");
    assert.equal(
      (await f.request(`areas/${next.workspace.areas[0].areaId}/state`)).status,
      409,
    );
    const exact = { proposalId: next.proposalId, revision: next.revision };
    const concurrent = await Promise.all([
      f.request("workspace/confirm", exact),
      f.request("workspace/confirm", exact),
    ]);
    assert(concurrent.some((response) => response.status === 200));
    assert(
      concurrent.every((response) => [200, 409].includes(response.status)),
    );
    const duplicate = await f.request("workspace/confirm", exact);
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).kind, "already_confirmed");
    assert.equal((await f.request("workspace/propose", plan)).status, 409);
    const state = WorkspaceState.parse(
      await (await f.request("workspace")).json(),
    );
    assert.equal(state.kind, "confirmed");
    for (const area of next.workspace.areas) {
      const snapshot = await f.area(area.areaId);
      assert.deepEqual(snapshot.thread.messages, []);
      assert.equal(snapshot.areaId, area.areaId);
    }
    assert.deepEqual(await f.home(), home);
    assert.deepEqual(
      await readFile(join(f.dir, "owner-profile.json")),
      profile,
    );
    assert.deepEqual(await f.auth.store.read("openai-codex"), credential);
    assert.deepEqual(f.schema(), schema);
    assert.deepEqual(
      f.db.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all(),
      gaiaSchema,
    );
    assert.equal(f.faux.state.callCount, 1);
    await f.reopen();
    assert.equal(f.faux.state.callCount, 1);
    assert.deepEqual(await f.home(), home);
    assert.deepEqual(
      WorkspaceState.parse(await (await f.request("workspace")).json()),
      state,
    );
    assert.deepEqual(await f.auth.store.read("openai-codex"), credential);
    assert.deepEqual(
      await readFile(join(f.dir, "owner-profile.json")),
      profile,
    );
  },
);

test("workspace and area HTTP retain existing host, origin, auth, release and schema bounds", async (t) => {
  const f = await workspaceFixture(t);
  const { first } = await f.confirm();
  for (const path of [
    "workspace",
    `areas/${first}/state`,
    `areas/${first}/history`,
  ]) {
    assert.equal(
      (await f.request(path, undefined, { origin: "https://evil.example" }))
        .status,
      403,
    );
    const address = f.app.server.address();
    assert(address && typeof address !== "string");
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = rawRequest(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path: "/api/v1/" + path,
          headers: { host: "evil.example" },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 403);
  }
  const writes: [string, unknown][] = [
    ["workspace/propose", plan],
    ["workspace/confirm", { proposalId: randomUUID(), revision: 1 }],
    [
      `areas/${first}/messages`,
      { requestId: randomUUID(), text: "Synthetic request" },
    ],
    [`areas/${first}/model`, { modelId: "gpt-6.1-sol" }],
    [`areas/${first}/compact`, {}],
    [`areas/${first}/retry`, {}],
    [`areas/${first}/stop`, {}],
    [
      `areas/${first}/attachments`,
      {
        id: randomUUID(),
        name: "synthetic.png",
        mimeType: "image/png",
        data: png,
      },
    ],
  ];
  for (const [path, input] of writes) {
    assert.equal(
      (await f.request(path, input, { origin: "https://evil.example" })).status,
      403,
    );
    assert.equal(
      (await f.request(path, input, { "sec-fetch-site": "cross-site" })).status,
      403,
    );
    assert.equal(
      (await f.request(path, input, { "Content-Type": "text/plain" })).status,
      415,
    );
    f.allowed = false;
    assert.equal((await f.request(path, input)).status, 503);
    f.allowed = true;
    f.connected = false;
    assert.equal((await f.request(path, input)).status, 409);
    f.connected = true;
  }
  for (const [path, input] of [
    ["workspace/propose", { ...plan, profile: { purpose: "Unapproved" } }],
    [
      `areas/${first}/messages`,
      { text: "x".repeat(32001), requestId: randomUUID() },
    ],
    [`areas/${first}/model`, { modelId: "unknown" }],
    [`areas/${first}/model`, { modelId: "text-only", thinkingLevel: "high" }],
    [`areas/${first}/compact`, { extra: true }],
    [`areas/${first}/retry`, { areaId: randomUUID() }],
  ] satisfies [string, unknown][])
    assert.equal((await f.request(path, input)).status, 400);
  assert.equal((await f.request(`areas/${randomUUID()}/state`)).status, 409);
  assert.equal((await f.request("areas/1/state")).status, 400);
  assert.equal(f.faux.state.callCount, 0);
});

test("single-purpose confirmation stays Home and multi-area enablement requires the parent baseline gate", async (t) => {
  const f = await workspaceFixture(t, false);
  const multi = WorkspaceProposal.parse(
    await (await f.request("workspace/propose", plan)).json(),
  );
  const denied = await f.request("workspace/confirm", {
    proposalId: multi.proposalId,
    revision: multi.revision,
  });
  assert.equal(denied.status, 409);
  assert.match(await denied.text(), /baseline/);
  const before = await f.home();
  const single = WorkspaceProposal.parse(
    await (
      await f.request("workspace/propose", {
        plan: { kind: "single", purpose: "Synthetic Home research" },
        sharedPreferences: [],
      })
    ).json(),
  );
  assert.equal(
    (
      await f.request("workspace/confirm", {
        proposalId: single.proposalId,
        revision: single.revision,
      })
    ).status,
    200,
  );
  const state = WorkspaceState.parse(
    await (await f.request("workspace")).json(),
  );
  assert.deepEqual(state.kind !== "empty" && state.proposal.workspace, {
    kind: "single",
    purpose: "Synthetic Home research",
  });
  assert.deepEqual(await f.home(), before);
  f.faux.setResponses([
    (context) => {
      assert.match(JSON.stringify(context), /Synthetic Home research/);
      assert(!JSON.stringify(context).includes("route_to_area"));
      return fauxAssistantMessage("Single Home answer");
    },
  ]);
  await f.request("messages", {
    requestId: randomUUID(),
    text: "Help with research",
  });
  assert.equal(
    (await f.settled()).thread.messages.at(-1)?.text,
    "Single Home answer",
  );
  await f.reopen();
  assert.equal(f.faux.state.callCount, 1);
});

test(
  "area image and effort requests, idempotence and retry preserve area, original selection and genuine history after reopen",
  { timeout: 10000 },
  async (t) => {
    const f = await workspaceFixture(t);
    const { first, second } = await f.confirm();
    assert.equal(
      (
        await f.request(`areas/${first}/model`, {
          modelId: "area-second",
          thinkingLevel: "high",
        })
      ).status,
      202,
    );
    const saved = Attachment.parse(
      await (
        await f.request(`areas/${first}/attachments`, {
          id: randomUUID(),
          name: "synthetic.png",
          mimeType: "image/png",
          data: png,
        })
      ).json(),
    );
    const input = {
      requestId: randomUUID(),
      text: "FIRST_AREA_IMAGE_MARKER",
      attachments: [saved.id],
    };
    let calls = 0;
    const answer = (
      context: { messages: unknown[]; tools?: unknown[] },
      options: { reasoning?: string } | undefined,
      _state: unknown,
      model: { id: string },
    ) => {
      calls++;
      assert.equal(model.id, "area-second");
      assert.equal(options?.reasoning, "high");
      assert.match(JSON.stringify(context.messages), /FIRST_AREA_IMAGE_MARKER/);
      assert.match(JSON.stringify(context.messages), /image\/png/);
      if (calls === 2)
        assert.match(
          JSON.stringify(context.messages),
          /Genuine first area answer/,
        );
      assert(!JSON.stringify(context).includes("SECOND_AREA_MARKER"));
      assert(!JSON.stringify(context).includes("route_to_area"));
      assert(!JSON.stringify(context).includes("propose_owner_profile"));
      return fauxAssistantMessage(
        calls === 1 ? "Genuine first area answer" : "Genuine area retry",
      );
    };
    f.faux.setResponses([answer]);
    assert.equal(
      (await f.request(`areas/${first}/messages`, input)).status,
      202,
    );
    assert.equal(
      (await f.settled(first)).thread.messages.at(-1)?.text,
      "Genuine first area answer",
    );
    const otherInput = { requestId: randomUUID(), text: "SECOND_AREA_MARKER" };
    f.faux.setResponses([
      (context) => {
        assert(!JSON.stringify(context).includes("FIRST_AREA_IMAGE_MARKER"));
        return fauxAssistantMessage("Independent second answer");
      },
    ]);
    await f.request(`areas/${second}/messages`, otherInput);
    await f.settled(second);
    const secondHistory = (await f.area(second)).thread;
    assert.equal(
      (await f.request(`areas/${first}/messages`, input)).status,
      200,
    );
    assert.equal(
      (await f.request(`areas/${second}/messages`, input)).status,
      409,
    );
    assert.equal((await f.request("messages", input)).status, 409);
    assert.equal(
      (
        await f.request(`areas/${first}/messages`, {
          ...input,
          text: "changed",
        })
      ).status,
      409,
    );
    await f.request(`areas/${first}/model`, { modelId: "text-only" });
    assert.equal(
      (
        await f.request(`areas/${first}/attachments`, {
          id: randomUUID(),
          name: "no.png",
          mimeType: "image/png",
          data: png,
        })
      ).status,
      409,
    );
    await f.reopen();
    assert.equal(f.faux.state.callCount, 2);
    f.faux.setResponses([answer]);
    assert.equal((await f.request(`areas/${first}/retry`, {})).status, 202);
    const retried = await f.settled(first);
    assert.equal(retried.thread.messages.at(-1)?.text, "Genuine area retry");
    assert.equal(
      retried.thread.messages.filter((message) => message.role === "user")
        .length,
      1,
    );
    assert.deepEqual(retried.thread.messages[0]?.attachments, [saved]);
    assert.equal((await f.area(first)).chat.modelId, "area-second");
    assert.deepEqual((await f.area(second)).thread, secondHistory);
    assert.deepEqual(
      Thread.parse(await (await f.request(`areas/${first}/history`)).json()),
      retried.thread,
    );
    assert.deepEqual((await f.home()).thread.messages, []);
    assert.equal(calls, 2);
    await f.reopen();
    assert.equal(f.faux.state.callCount, 3);
    assert.deepEqual((await f.area(first)).thread, retried.thread);
  },
);

test("model and upload controls preserve Home stopped/error retry state", async (t) => {
  const f = await workspaceFixture(t);
  f.faux.setResponses([
    fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: "Private synthetic failure",
    }),
  ]);
  await f.request("messages", {
    requestId: randomUUID(),
    text: "Retain failed request",
  });
  const failed = await f.settled();
  assert.equal(failed.thread.run.kind, "error");
  await f.request("model", { modelId: "area-second" });
  assert.deepEqual((await f.home()).thread, failed.thread);
  await f.request("attachments", {
    id: randomUUID(),
    name: "retain.png",
    mimeType: "image/png",
    data: png,
  });
  assert.deepEqual((await f.home()).thread, failed.thread);
  const started = deferred();
  f.faux.setResponses([
    async (_context, options) => {
      started.resolve();
      assert(options?.signal);
      await new Promise<void>((resolve) =>
        options.signal?.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
      return fauxAssistantMessage("", { stopReason: "aborted" });
    },
  ]);
  await f.request("retry", {});
  await started.promise;
  await f.request("stop", {});
  const stopped = await f.settled();
  assert.equal(stopped.thread.run.kind, "stopped");
  await f.request("model", { modelId: "area-second" });
  assert.deepEqual((await f.home()).thread, stopped.thread);
});
