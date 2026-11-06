import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createAuth } from "./auth.ts";
import { defaultPlanModel } from "../../core/plan-models.ts";

test("Claude-only default is Opus 5.5 from Pi's real catalogue", async () => {
  const db = new DatabaseSync(":memory:");
  const auth = createAuth(db);
  try {
    await auth.store.modify("anthropic", async () => ({
      type: "oauth",
      access: "synthetic",
      refresh: "synthetic",
      expires: Date.now() + 3600000,
    }));
    assert(auth.models.getModel("anthropic", "claude-opus-5-5"));
    assert.deepEqual(defaultPlanModel(auth.models, auth.planAvailability), {
      provider: "anthropic",
      modelId: "claude-opus-5-5",
    });
  } finally {
    await auth.close();
    db.close();
  }
});

import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
test("Claude fallback follows explicit preferences when Pi's primary model is absent", async () => {
  const db = new DatabaseSync(":memory:");
  const auth = createAuth(db);
  const provider = anthropicProvider();
  auth.models.setProvider({
    ...provider,
    getModels: () =>
      [...provider.getModels()]
        .filter((model) => model.id !== "claude-opus-5-5")
        .reverse(),
  });
  try {
    await auth.store.modify("anthropic", async () => ({
      type: "oauth",
      access: "synthetic",
      refresh: "synthetic",
      expires: Date.now() + 3600000,
    }));
    assert.deepEqual(defaultPlanModel(auth.models, auth.planAvailability), {
      provider: "anthropic",
      modelId: "claude-sonnet-5-5",
    });
  } finally {
    await auth.close();
    db.close();
  }
});

import { createModels } from "@earendil-works/pi-ai";
import { planModels } from "../../core/plan-models.ts";
test("model availability fails closed unless an explicit plan source allows it", () => {
  const models = createModels();
  models.setProvider(anthropicProvider());
  assert.deepEqual(planModels(models), []);
  assert.deepEqual(
    planModels(models, { connectedProviders: () => new Set() }),
    [],
  );
  assert(
    planModels(models, { connectedProviders: () => new Set(["anthropic"]) })
      .length > 0,
  );
});
