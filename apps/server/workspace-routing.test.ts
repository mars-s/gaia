import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Attachment } from "../../packages/protocol/attachments.ts";
import { WorkspaceState } from "../../packages/sdk/workspace.ts";
import { openOwnerProfile } from "./profile.ts";
import { deferred, plan, png, workspaceFixture } from "./testing/workspace.ts";

test("Home can propose a workspace but only the exact owner API confirmation creates areas", async (t) => {
  const f = await workspaceFixture(t);
  assert(openOwnerProfile(f.db).action("skip"));
  f.faux.setResponses([
    (context) => {
      const tools = context.messages.flatMap((message) =>
        message.role === "system" ? (message.toolsAdded ?? []) : [],
      );
      assert(tools.some((tool) => tool.name === "propose_workspace"));
      assert(!tools.some((tool) => /confirm/.test(tool.name)));
      return fauxAssistantMessage(fauxToolCall("propose_workspace", plan), {
        stopReason: "toolUse",
      });
    },
    (context) => {
      assert(
        context.messages.some(
          (message) =>
            message.role === "toolResult" &&
            message.toolName === "propose_workspace" &&
            !message.isError,
        ),
      );
      return fauxAssistantMessage("Review the proposed workspace in the app.");
    },
  ]);
  await f.request("messages", {
    text: "Propose these explicit synthetic purposes",
    requestId: randomUUID(),
  });
  assert.equal(
    (await f.settled()).thread.messages.at(-1)?.text,
    "Review the proposed workspace in the app.",
  );
  const state = WorkspaceState.parse(
    await (await f.request("workspace")).json(),
  );
  assert.equal(state.kind, "proposed");
  if (state.kind !== "proposed" || state.proposal.workspace.kind !== "multi")
    throw new Error("Expected pending multi.");
  assert.equal(
    (await f.request(`areas/${state.proposal.workspace.areas[0].areaId}/state`))
      .status,
    409,
  );
  f.faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("route_to_area", {
        areaId: state.proposal.workspace.areas[0].areaId,
        text: "Unconfirmed target",
      }),
      { stopReason: "toolUse" },
    ),
    (context) => {
      const result = context.messages.findLast(
        (message) => message.role === "toolResult",
      );
      assert(result && result.role === "toolResult" && result.isError);
      return fauxAssistantMessage("Wait for exact owner confirmation.");
    },
  ]);
  await f.request("messages", {
    text: "Synthetic unconfirmed route",
    requestId: randomUUID(),
  });
  assert.equal(
    (await f.settled()).thread.messages.at(-1)?.text,
    "Wait for exact owner confirmation.",
  );
  assert.equal(openOwnerProfile(f.db).read().kind, "skipped");
  assert.equal(
    (
      await f.request("workspace/confirm", {
        proposalId: state.proposal.proposalId,
        revision: state.proposal.revision,
      })
    ).status,
    200,
  );
  assert.equal(f.faux.state.callCount, 4);
});

test(
  "Home routing returns the genuine isolated area result with only explicit text, preferences and selected images",
  { timeout: 10000 },
  async (t) => {
    const f = await workspaceFixture(t);
    const { first, second } = await f.confirm();
    f.faux.setResponses([fauxAssistantMessage("Private Home answer")]);
    await f.request("messages", {
      text: "HOME_PRIVATE_CONTEXT_MARKER",
      requestId: randomUUID(),
    });
    await f.settled();
    f.faux.setResponses([fauxAssistantMessage("Private second answer")]);
    await f.request(`areas/${second}/messages`, {
      text: "OTHER_AREA_PRIVATE_MARKER",
      requestId: randomUUID(),
    });
    await f.settled(second);
    const secondBefore = (await f.area(second)).thread;
    await f.request(`areas/${first}/model`, {
      modelId: "area-second",
      thinkingLevel: "high",
    });
    const image = Attachment.parse(
      await (
        await f.request("attachments", {
          id: randomUUID(),
          name: "route.png",
          mimeType: "image/png",
          data: png,
        })
      ).json(),
    );
    let areaCalled = false;
    f.faux.setResponses([
      () =>
        fauxAssistantMessage(
          fauxToolCall("route_to_area", {
            areaId: first,
            text: "EXPLICIT_ROUTED_REQUEST",
            imageIndexes: [0],
          }),
          { stopReason: "toolUse" },
        ),
      (context, options, _state, model) => {
        areaCalled = true;
        const json = JSON.stringify(context);
        assert.equal(model.id, "area-second");
        assert.equal(options?.reasoning, "high");
        assert.match(json, /EXPLICIT_ROUTED_REQUEST/);
        assert.match(json, /Synthetic research purpose marker/);
        assert.match(json, /Explicit shared preference marker/);
        assert.match(json, /image\/png/);
        assert(!json.includes("HOME_PRIVATE_CONTEXT_MARKER"));
        assert(!json.includes("OTHER_AREA_PRIVATE_MARKER"));
        assert(!json.includes("Synthetic garden purpose marker"));
        const tools = context.messages.flatMap((message) =>
          message.role === "system" ? (message.toolsAdded ?? []) : [],
        );
        assert.deepEqual(tools, []);
        return fauxAssistantMessage("GENUINE_AREA_RESULT_4827");
      },
      (context, _options, _state, model) => {
        assert(areaCalled);
        assert.equal(model.id, "gpt-6.1-sol");
        const result = context.messages.findLast(
          (message) =>
            message.role === "toolResult" &&
            message.toolName === "route_to_area",
        );
        assert(result && result.role === "toolResult" && !result.isError);
        assert.match(
          JSON.stringify(result.content),
          /GENUINE_AREA_RESULT_4827/,
        );
        return fauxAssistantMessage("Home received GENUINE_AREA_RESULT_4827.");
      },
    ]);
    await f.request("messages", {
      text: "Route just the explicit request and selected image",
      attachments: [image.id],
      requestId: randomUUID(),
    });
    assert.equal(
      (await f.settled()).thread.messages.at(-1)?.text,
      "Home received GENUINE_AREA_RESULT_4827.",
    );
    const routed = await f.area(first);
    assert.deepEqual(
      routed.thread.messages.map((message) => message.text),
      ["EXPLICIT_ROUTED_REQUEST", "GENUINE_AREA_RESULT_4827"],
    );
    assert.deepEqual(routed.thread.messages[0]?.attachments, [image]);
    const routedUser = routed.thread.messages[0];
    assert(routedUser);
    const duplicate = {
      text: routedUser.text,
      requestId: routedUser.id,
      attachments: [image.id],
    };
    assert.equal((await f.request("messages", duplicate)).status, 409);
    assert.equal(
      (await f.request(`areas/${second}/messages`, duplicate)).status,
      409,
    );
    assert.equal(
      (await f.request(`areas/${first}/messages`, duplicate)).status,
      200,
    );
    assert.deepEqual((await f.area(second)).thread, secondBefore);
    await f.reopen();
    assert.equal(f.faux.state.callCount, 5);
    assert.deepEqual((await f.area(first)).thread, routed.thread);
  },
);

test("routing rejects unconfirmed and unknown IDs, oversized text and absent images before area model calls", async (t) => {
  const f = await workspaceFixture(t);
  const { first } = await f.confirm();
  const requests: Parameters<typeof fauxToolCall>[1][] = [
    { areaId: randomUUID(), text: "Unknown" },
    { areaId: first, text: "x".repeat(8001) },
    { areaId: first, text: "Missing image", imageIndexes: [0] },
    {
      areaId: first,
      text: "Invalid image count",
      imageIndexes: [0, 1, 2, 3, 4],
    },
    { areaId: first, text: "Invalid fields", modelTools: ["route_to_area"] },
  ];
  for (const route of requests) {
    f.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("route_to_area", route), {
        stopReason: "toolUse",
      }),
      (context) => {
        const result = context.messages.findLast(
          (message) => message.role === "toolResult",
        );
        assert(result && result.role === "toolResult" && result.isError);
        return fauxAssistantMessage("Routing refused.");
      },
    ]);
    await f.request("messages", {
      text: "Synthetic invalid route",
      requestId: randomUUID(),
    });
    assert.equal(
      (await f.settled()).thread.messages.at(-1)?.text,
      "Routing refused.",
    );
  }
  assert.equal(f.faux.state.callCount, 2 * requests.length);
  assert.deepEqual((await f.area(first)).thread.messages, []);
});

test("one routing call per Home turn prevents fan-out and areas cannot inherit model tools", async (t) => {
  const f = await workspaceFixture(t);
  const { first, second } = await f.confirm();
  f.faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("route_to_area", {
          areaId: first,
          text: "One permitted request",
        }),
        fauxToolCall("route_to_area", {
          areaId: second,
          text: "Rejected second request",
        }),
      ],
      { stopReason: "toolUse" },
    ),
    (context) => {
      assert(!JSON.stringify(context).includes("route_to_area"));
      return fauxAssistantMessage("Only one area ran");
    },
    (context) => {
      const results = context.messages.filter(
        (message) =>
          message.role === "toolResult" && message.toolName === "route_to_area",
      );
      assert.equal(results.length, 2);
      assert.equal(
        results.filter(
          (message) => message.role === "toolResult" && message.isError,
        ).length,
        1,
      );
      return fauxAssistantMessage("One result retained.");
    },
  ]);
  await f.request("messages", {
    text: "Synthetic parallel routing requests",
    requestId: randomUUID(),
  });
  assert.equal(
    (await f.settled()).thread.messages.at(-1)?.text,
    "One result retained.",
  );
  assert.equal(f.faux.state.callCount, 3);
  assert.deepEqual((await f.area(second)).thread.messages, []);
});

for (const action of ["stop", "shutdown"] as const)
  test(
    `Home ${action} cancels and joins the ownerless routed provider before releasing admission`,
    { timeout: 10000 },
    async (t) => {
      const f = await workspaceFixture(t);
      const { first, second } = await f.confirm();
      const started = deferred();
      const aborted = deferred();
      const release = deferred();
      f.faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall("route_to_area", {
            areaId: first,
            text: "Synthetic routed cancellable request",
          }),
          { stopReason: "toolUse" },
        ),
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
      await f.request("messages", {
        text: "Route a cancellable request",
        requestId: randomUUID(),
      });
      await started.promise;
      for (const [path, input] of [
        [
          `areas/${second}/messages`,
          { requestId: randomUUID(), text: "Conflict" },
        ],
        [`areas/${first}/retry`, {}],
        [`areas/${second}/model`, { modelId: "area-second" }],
        ["workspace/confirm", { proposalId: randomUUID(), revision: 1 }],
        ["model", { modelId: "area-second" }],
      ] satisfies [string, unknown][])
        assert.equal((await f.request(path, input)).status, 409);
      assert.equal((await f.request(`areas/${second}/stop`, {})).status, 409);
      let closed = false;
      if (action === "stop") await f.request("stop", {});
      const done =
        action === "shutdown"
          ? f.close().then(() => {
              closed = true;
            })
          : undefined;
      await aborted.promise;
      assert.equal(closed, false);
      if (action === "stop") {
        assert.equal((await f.home()).thread.run.kind, "running");
        assert.equal(
          (await f.request(`areas/${second}/compact`, {})).status,
          409,
        );
      }
      release.resolve();
      if (done) await done;
      else {
        assert.equal((await f.settled()).thread.run.kind, "stopped");
        assert.equal((await f.area(first)).thread.run.kind, "stopped");
      }
      assert.equal(f.faux.state.callCount, 2);
    },
  );
