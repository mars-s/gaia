import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { experienceFixture, png } from "./testing/experiences.ts";

test("scope catalogues and admission follow live Pi models across changes and reopen", async (t) => {
  const f = await experienceFixture(t);
  const state = await f.confirm();
  const profile = state.profile.id;
  const scope = state.scopes[0].id;
  const route = `experiences/${profile}/scopes/${scope}`;
  const original = f.faux.provider;
  const custom = fauxProvider({
    provider: "openai-codex",
    models: [
      { id: "zeta", name: "Zeta 1", reasoning: false, input: ["text"] },
      {
        id: "custom",
        name: "Custom",
        reasoning: false,
        input: ["text", "image"],
      },
    ],
  });
  f.auth.models.setProvider(custom.provider);
  assert.deepEqual(
    (await f.scope(profile, scope)).chat.models.map((m) => m.id),
    ["zeta", "custom"],
  );
  assert.equal((await f.scope(profile, scope)).chat.modelId, "gpt-6.1-sol");
  const imageId = randomUUID();
  assert.equal(
    (
      await f.request(`${route}/attachments`, {
        id: imageId,
        name: "draft.png",
        mimeType: "image/png",
        data: png,
      })
    ).status,
    201,
  );
  const draft = {
    requestId: randomUUID(),
    text: "Keep this draft",
    attachments: [imageId],
  };
  const refused = await f.request(`${route}/messages`, draft);
  assert.equal(refused.status, 409);
  assert.match(await refused.text(), /not available now.*Choose another model/);
  assert.equal((await f.scope(profile, scope)).messages.length, 0);
  assert.equal(
    (await f.request(`${route}/attachments/${imageId}`)).status,
    200,
  );
  assert.equal(
    (
      await f.request(`${route}/model`, {
        modelId: "gpt-6.1-sol",
        thinkingLevel: "high",
      })
    ).status,
    400,
  );
  assert.equal(
    (await f.request(`${route}/model`, { modelId: "zeta" })).status,
    200,
  );
  assert.equal((await f.request(`${route}/messages`, draft)).status, 409);
  // Changing capability for the same id must override the stored compatibility cache.
  const updated = fauxProvider({
    provider: "openai-codex",
    models: [{ id: "zeta", reasoning: false, input: ["text", "image"] }],
  });
  f.auth.models.setProvider(updated.provider);
  const runtime = await f.pi.experiences!.resolve(profile);
  assert(runtime);
  assert.equal(
    (await runtime.scopeState(scope)).chat.models[0].capabilities?.images,
    true,
  );
  updated.setResponses([
    fauxAssistantMessage("Updated image capability accepted"),
  ]);
  const changedCapability = await f.request(`${route}/messages`, {
    ...draft,
    requestId: randomUUID(),
  });
  assert.equal(
    changedCapability.status,
    202,
    await changedCapability.clone().text(),
  );
  const changedJob = await changedCapability.json();
  assert.equal(
    (await f.settled(profile, changedJob.jobId)).state.kind,
    "completed",
  );
  f.auth.models.setProvider(original);
  await f.reopen();
  const reopened = await f.scope(profile, scope);
  assert.equal(reopened.chat.modelId, "zeta");
  assert.deepEqual(
    reopened.chat.models.map((m) => m.id),
    ["gpt-6.1-sol", "second"],
  );
  assert.equal((await f.request(`${route}/messages`, draft)).status, 409);
  assert.equal(
    (
      await f.request(`${route}/model`, {
        modelId: "gpt-6.1-sol",
        thinkingLevel: "high",
      })
    ).status,
    200,
  );
  f.faux.setResponses([fauxAssistantMessage("Image draft accepted")]);
  const admitted = await f.request(`${route}/messages`, draft);
  assert.equal(admitted.status, 202, await admitted.clone().text());
  const job = await admitted.json();
  assert.equal((await f.settled(profile, job.jobId)).state.kind, "completed");
});
