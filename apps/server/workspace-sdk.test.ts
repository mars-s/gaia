import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import {
  areaCommand,
  confirmWorkspace,
  proposeWorkspace,
  readArea,
  readAreaHistory,
  readWorkspace,
  uploadAreaImage,
} from "../../packages/sdk/workspace-client.ts";
import { plan, png, workspaceFixture } from "./testing/workspace.ts";

test("workspace SDK validates real HTTP contracts, keeps explicit area targeting and propagates errors", async (t) => {
  const f = await workspaceFixture(t);
  const address = f.app.server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    original(
      typeof input === "string" && input.startsWith("/api/v1/")
        ? base + input
        : input,
      init,
    );
  t.after(() => {
    globalThis.fetch = original;
  });
  assert.deepEqual(await readWorkspace(), { kind: "empty" });
  const proposal = await proposeWorkspace(plan);
  const confirmed = await confirmWorkspace({
    proposalId: proposal.proposalId,
    revision: proposal.revision,
  });
  assert.equal(confirmed.kind, "confirmed");
  if (confirmed.workspace.kind !== "multi") throw new Error("Expected multi.");
  const [area] = confirmed.workspace.areas;
  await areaCommand(area.areaId, "model", {
    modelId: "area-second",
    thinkingLevel: "high",
  });
  const saved = await uploadAreaImage(area.areaId, {
    id: randomUUID(),
    name: "SDK.png",
    mimeType: "image/png",
    data: png,
  });
  f.faux.setResponses([fauxAssistantMessage("SDK area response")]);
  await areaCommand(area.areaId, "messages", {
    text: "SDK explicit request",
    requestId: randomUUID(),
    attachments: [saved.id],
  });
  await f.settled(area.areaId);
  assert.equal(
    (await readArea(area.areaId)).thread.messages.at(-1)?.text,
    "SDK area response",
  );
  assert.equal(
    (await readAreaHistory(area.areaId)).messages[0]?.text,
    "SDK explicit request",
  );
  await assert.rejects(
    areaCommand(area.areaId, "model", { modelId: "unknown" }),
    /Unknown OpenAI model/,
  );
  assert.equal((await f.home()).thread.messages.length, 0);
});
