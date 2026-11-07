import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createAuth } from "./auth.ts";
import { createPi } from "./pi.ts";
import { Critique, criticPrompt, reviewPreview } from "./self-change-review.ts";
import { readFileSync } from "node:fs";

const name = "after-empty-320-light.jpg";
const critique = { critic: "fresh", score: 2, summary: "The next action is hard to find.", blocking: [{ issue: "Action is unclear", shots: [name] }], minor: [] };
const output = [{ type: "text" as const, text: "PRIVATE_DIFF_MUST_NOT_REACH_CRITIC" }, { type: "text" as const, text: name }, { type: "image" as const, data: "ZmFrZS1maXh0dXJlLWltYWdl", mimeType: "image/jpeg" }];

test("critic rubric matches protected compact questions and rejects malformed scores or evidence", async () => {
  for (const question of readFileSync("core/design/rubric-compact.md", "utf8").trim().split("\n")) assert(criticPrompt.includes(question));
  assert(!Critique.safeParse({ ...critique, score: 11 }).success);
  assert(!Critique.safeParse({ ...critique, blocking: Array(6).fill(critique.blocking[0]) }).success);
  const faux = fauxProvider({ provider: "openai-codex", models: [{ id: "gpt-6.1-sol" }], tokensPerSecond: 100000 });
  const { createModels } = await import("@earendil-works/pi-ai/models");
  const models = createModels(); models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage(JSON.stringify({ ...critique, blocking: [{ issue: "Missing action", shots: ["invented.jpg"] }] }))]);
  await assert.rejects(reviewPreview({ models, model: { provider: "openai-codex", modelId: "gpt-6.1-sol" }, output }), /unknown screenshot/);
  await assert.rejects(reviewPreview({ models, model: { provider: "unconnected-api", modelId: "any" }, output }), /connected ChatGPT or Claude plan/);
});

test("real Pi tool calls run a fresh same-plan critic, keep low scores advisory and cap revision previews", async () => {
  const root = await mkdtemp("/private/tmp/gaia-critic-"), db = new DatabaseSync(join(root, "auth.sqlite")), auth = createAuth(db);
  const faux = fauxProvider({ provider: "openai-codex", models: [{ id: "gpt-6.1-sol", reasoning: true }], tokensPerSecond: 100000 });
  auth.models.setProvider(faux.provider); auth.planAvailability.connectedProviders = () => new Set(["openai-codex"]);
  let renders = 0, critics = 0;
  const extension = defineExtension({ name: "preview-fixture", tools: [defineTool({ name: "self_change", description: "Fixture", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] }, async execute() { renders++; return { output }; } })] });
  const pi = await createPi(join(root, "pi.sqlite"), auth, [extension]);
  const preview = () => fauxAssistantMessage(fauxToolCall("self_change", { command: JSON.stringify({ kind: "preview", id: randomUUID() }) }), { stopReason: "toolUse" });
  try {
    faux.setResponses([
      preview(), context => { critics++; assert(!JSON.stringify(context).includes("PRIVATE_OWNER_CHAT")); assert(!JSON.stringify(context).includes("PRIVATE_DIFF")); assert(JSON.stringify(context).includes("fresh UI critic")); return fauxAssistantMessage(JSON.stringify(critique)); },
      preview(), () => { critics++; return fauxAssistantMessage(JSON.stringify(critique)); },
      preview(), () => { critics++; return fauxAssistantMessage(JSON.stringify(critique)); },
      preview(), context => { assert(JSON.stringify(context).includes("Three preview attempts reached")); return fauxAssistantMessage("The low review score does not block submission."); },
    ]);
    let answer = "";
    await pi.run({ text: "PRIVATE_OWNER_CHAT, revise this UI", requestId: randomUUID(), onText: text => { answer = text; }, signal: new AbortController().signal });
    assert.equal(renders, 3); assert.equal(critics, 3); assert.match(answer, /does not block/);
    faux.setResponses([preview(), fauxAssistantMessage("invalid critic JSON"), context => { assert(JSON.stringify(context).includes("review was unavailable")); return fauxAssistantMessage("You may submit."); }]);
    await pi.run({ text: "A new request", requestId: randomUUID(), onText() {}, signal: new AbortController().signal });
    assert.equal(renders, 4, "new owner turn starts a new revision budget");
  } finally { await pi.close(); await auth.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});
