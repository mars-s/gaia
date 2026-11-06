import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createAuth } from "./auth.ts";
test("credential writes are serialised, survive reopening, metadata hides secrets", async () => {
  const db = new DatabaseSync(":memory:");
  const auth = createAuth(db);
  await auth.store.modify("openai-codex", async () => ({
    type: "oauth",
    access: "test-access",
    refresh: "test-refresh",
    expires: 1,
  }));
  const order: number[] = [];
  await Promise.all([
    auth.store.modify("openai-codex", async (current) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(1);
      assert.equal(current?.type, "oauth");
      return {
        type: "oauth",
        access: "updated",
        refresh: "test-refresh",
        expires: 2,
      };
    }),
    auth.store.modify("openai-codex", async (current) => {
      order.push(2);
      assert.equal(current?.type === "oauth" && current.access, "updated");
      return current;
    }),
  ]);
  assert.deepEqual(order, [1, 2]);
  assert.deepEqual(await auth.store.list(), [
    { providerId: "openai-codex", type: "oauth" },
  ]);
  const reopened = createAuth(db);
  assert.equal((await reopened.store.read("openai-codex"))?.type, "oauth");
  assert(!JSON.stringify(reopened.status()).includes("updated"));
  await reopened.store.delete("openai-codex");
  assert.equal(await reopened.store.read("openai-codex"), undefined);
  await auth.close();
  await reopened.close();
  db.close();
});

import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { planModels, defaultPlanModel } from "../../core/plan-models.ts";

for (const provider of ["openai-codex", "anthropic"] as const) {
  test(`${provider} OAuth login, refresh and disconnect preserve the other plan`, async () => {
    const db = new DatabaseSync(":memory:");
    const auth = createAuth(db);
    const real =
      provider === "anthropic" ? anthropicProvider() : openaiCodexProvider();
    let refreshed = 0;
    auth.models.setProvider({
      ...real,
      auth: {
        oauth: {
          name: "Synthetic subscription",
          async login(interaction) {
            interaction.notify({
              type: "auth_url",
              url: "https://example.test/authorise",
            });
            const code = await interaction.prompt({
              type: "manual_code",
              message: "Synthetic code",
            });
            assert.equal(code, "synthetic-code");
            return {
              type: "oauth",
              access: "fake-expired",
              refresh: "fake-refresh",
              expires: 1,
            };
          },
          async refresh(credential) {
            assert.equal(credential.refresh, "fake-refresh");
            refreshed++;
            return {
              ...credential,
              access: "fake-refreshed",
              refresh: "fake-rotated",
              expires: Date.now() + 3600000,
            };
          },
          async toAuth(credential) {
            return { apiKey: credential.access };
          },
        },
      },
    });
    await auth.initialise(false);
    auth.connect(provider);
    for (let i = 0; i < 50 && auth.status().kind === "connecting"; i++) {
      const status = auth.status();
      if (status.kind === "connecting" && status.prompt) break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const pending = auth.status();
    assert.equal(pending.kind, "connecting");
    assert(pending.kind === "connecting" && pending.url && pending.prompt);
    auth.reply("synthetic-code");
    for (let i = 0; i < 50 && auth.status().kind === "connecting"; i++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(auth.status().kind, "connected");
    assert(
      planModels(auth.models, auth.planAvailability).every((model) => model.provider === provider),
    );
    assert.equal(defaultPlanModel(auth.models, auth.planAvailability).provider, provider);
    const resolutions = await Promise.all([
      auth.models.getAuth(provider),
      auth.models.getAuth(provider),
    ]);
    assert.deepEqual(
      resolutions.map((result) => result?.source),
      ["OAuth", "OAuth"],
    );
    assert.equal(refreshed, 1);
    assert.equal((await auth.store.read(provider))?.type, "oauth");
    const other = provider === "anthropic" ? "openai-codex" : "anthropic";
    await auth.store.modify(other, async () => ({
      type: "oauth",
      access: "fake-other",
      refresh: "fake-other-refresh",
      expires: Date.now() + 3600000,
    }));
    assert.equal((await auth.store.list()).length, 2);
    assert.equal(
      new Set(planModels(auth.models, auth.planAvailability).map((model) => model.provider)).size,
      2,
    );
    assert.equal(defaultPlanModel(auth.models, auth.planAvailability).modelId, "gpt-6.1-sol");
    const reopened = createAuth(db);
    await reopened.initialise(false);
    assert.equal(
      reopened.status().plans?.filter((plan) => plan.connected).length,
      2,
    );
    assert(!JSON.stringify(auth.status()).includes("fake-"));
    await auth.disconnect(provider);
    assert.equal(await auth.store.read(provider), undefined);
    assert(await auth.store.read(other));
    assert(planModels(auth.models, auth.planAvailability).every((model) => model.provider === other));
    await auth.disconnect(other);
    assert.equal(auth.status().kind, "disconnected");
    assert.equal(planModels(auth.models, auth.planAvailability).length, 0);
    await auth.close();
    await reopened.close();
    db.close();
  });
}

test("credential deletion queues behind refresh and before later writes", async () => {
  const db = new DatabaseSync(":memory:");
  const auth = createAuth(db);
  const write = auth.store.modify("anthropic", async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { type: "oauth", access: "fake", refresh: "fake", expires: 1 };
  });
  const remove = auth.store.delete("anthropic");
  const observe = auth.store.modify("anthropic", async (current) => {
    assert.equal(current, undefined);
    return undefined;
  });
  await Promise.all([write, remove, observe]);
  assert.equal(await auth.store.read("anthropic"), undefined);
  await auth.close();
  db.close();
});
