import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createAuth } from "./auth.ts";
import { openDatabase } from "./server.ts";
import { createPi } from "./pi.ts";

for (const onlyClaude of [false, true]) {
  test(`real Pi adapter routes Claude with ${onlyClaude ? "only Claude" : "both plans"} available`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "gaia-claude-models-"));
    const db = await openDatabase(dir);
    const auth = createAuth(db);
    const claude = fauxProvider({
      provider: "anthropic",
      models: [
        {
          id: "claude-opus-5-5",
          name: "Synthetic Claude",
          input: ["text", "image"],
          reasoning: true,
        },
      ],
      tokensPerSecond: 100000,
    });
    const codex = fauxProvider({
      provider: "openai-codex",
      models: [{ id: "gpt-6.1-sol" }],
      tokensPerSecond: 100000,
    });
    auth.models.setProvider(claude.provider);
    auth.models.setProvider(codex.provider);
    claude.setResponses([
      (context) => {
        assert.doesNotMatch(JSON.stringify(context), /"name":"search_web"/);
        assert.match(
          JSON.stringify(context),
          /Hosted web search is unavailable for this model/,
        );
        return fauxAssistantMessage("Synthetic Claude reply");
      },
    ]);
    codex.setResponses([fauxAssistantMessage("Synthetic ChatGPT reply")]);
    let available = onlyClaude ? "anthropic" : "both";
    auth.planAvailability.connectedProviders = () =>
      new Set(
        available === "both" ? ["openai-codex", "anthropic"] : [available],
      );
    const pi = await createPi(
      join(dir, "pi.sqlite"),
      auth,
      [],
      {},
      {
        tools: {
          receiptDirectory: join(dir, "receipts"),
          generation: "fixture",
          mode: "stable",
          enabled: () => true,
        },
      },
    );
    try {
      assert.equal(pi.controls?.().models.length, onlyClaude ? 1 : 2);
      if (!onlyClaude) await pi.configure?.("claude-opus-5-5");
      assert.equal(pi.controls?.().modelId, "claude-opus-5-5");
      await pi.run({
        text: "hello",
        requestId: randomUUID(),
        onText() {},
        signal: new AbortController().signal,
      });
      assert.equal(claude.state.callCount, 1);
      assert.equal(codex.state.callCount, 0);
      available = "openai-codex";
      await pi.run({
        text: "after disconnect",
        requestId: randomUUID(),
        onText() {},
        signal: new AbortController().signal,
      });
      assert.equal(pi.controls?.().modelId, "gpt-6.1-sol");
      assert.equal(codex.state.callCount, 1);
    } finally {
      await pi.close();
      await auth.close();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}

import { experienceFixture } from "./testing/experiences.ts";

test("Claude-only setups admit and complete independent jobs through Pi", async (t) => {
  const f = await experienceFixture(t);
  const claude = fauxProvider({
    provider: "anthropic",
    models: [
      { id: "claude-opus-5-5", name: "Synthetic Claude", reasoning: true },
    ],
    tokensPerSecond: 100000,
  });
  claude.setResponses([fauxAssistantMessage("Synthetic Claude setup reply")]);
  f.auth.models.setProvider(claude.provider);
  f.auth.planAvailability.connectedProviders = () => new Set(["anthropic"]);
  const state = await f.confirm();
  const profile = state.profile.id;
  const scope = state.scopes[0].id;
  const initial = await f.scope(profile, scope);
  assert.equal(initial.chat.modelId, "claude-opus-5-5");
  assert.deepEqual(
    initial.chat.models.map((model) => model.id),
    ["claude-opus-5-5"],
  );
  const admission = await f.send(profile, scope, "hello Claude");
  const job = await f.settled(profile, admission.jobId);
  assert.equal(job.state.kind, "completed");
  assert.equal(claude.state.callCount, 1);
  assert.match(
    JSON.stringify((await f.scope(profile, scope)).messages),
    /Synthetic Claude setup reply/,
  );
});
