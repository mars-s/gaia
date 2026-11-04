import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";
import {
  AgentDoc,
  Harness,
  UserEntry,
  createRegistry,
  defineExtension,
  defineTool,
  section,
  type HarnessOptions,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import {
  AreaId,
  WorkspaceRequest,
  WorkspaceState,
  type WorkspaceProposal,
} from "../../packages/sdk/workspace.ts";
import { openWorkspace, type WorkspaceSettings } from "./workspace.ts";

const settings: WorkspaceSettings = {
  model: { provider: "workspace-test", modelId: "model-a" },
  thinkingLevel: "high",
};
const request: WorkspaceRequest = {
  plan: {
    kind: "multi",
    areas: [
      {
        label: "Research",
        purpose: "Find papers about synthetic research topics.",
      },
      { label: "Garden", purpose: "Plan synthetic garden jobs." },
    ],
  },
  sharedPreferences: ["Use Australian English. Synthetic preference marker."],
};

async function fixture(
  t: TestContext,
  conversationCreated?: HarnessOptions["conversationCreated"],
) {
  const directory = await mkdtemp(join(tmpdir(), "gaia-workspace-"));
  const path = join(directory, "pi.sqlite");
  const faux = fauxProvider({
    provider: "workspace-test",
    models: [
      { id: "model-a", reasoning: true },
      { id: "model-b", reasoning: true },
    ],
    tokensPerSecond: 100000,
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  const homeExtension = defineExtension({
    name: "home-only",
    tools: [
      defineTool({
        name: "home_private_tool",
        description: "Test only.",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ output: [] }),
      }),
    ],
    sections: [section("home-private", () => "HOME_EXTENSION_PRIVATE_MARKER")],
  });
  registry.install(homeExtension);
  const options: HarnessOptions = {
    models,
    registry,
    conversationCreated,
    settings: { retry: { maxRetries: 0 }, compaction: { enabled: false } },
  };
  let harness = await Harness.open(
    await openNodeSqliteStorage(path),
    options,
    ctx,
  );
  const home = await harness.root(ctx, {
    agent: { ...settings, instructions: "HOME_INSTRUCTIONS_PRIVATE_MARKER" },
  });
  t.after(async () => {
    await harness.close(ctx);
    await rm(directory, { recursive: true, force: true });
  });
  const schema = () => {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      return db
        .prepare(
          "SELECT type, name, sql FROM sqlite_master ORDER BY type, name",
        )
        .all();
    } finally {
      db.close();
    }
  };
  return {
    harness,
    home,
    faux,
    schema,
    workspace: await openWorkspace({ harness, home }, ctx),
    async reopen() {
      await harness.close(ctx);
      harness = await Harness.open(
        await openNodeSqliteStorage(path),
        options,
        ctx,
      );
      const home = await harness.root(ctx);
      return {
        harness,
        home,
        workspace: await openWorkspace({ harness, home }, ctx),
      };
    },
  };
}

function areas(proposal: WorkspaceProposal) {
  assert.equal(proposal.workspace.kind, "multi");
  if (proposal.workspace.kind !== "multi")
    throw new Error("Expected multi workspace.");
  const [first, second] = proposal.workspace.areas;
  return { first, second };
}

test("workspace schemas reject duplicate, unbounded and incomplete area plans", () => {
  assert.throws(() =>
    WorkspaceRequest.parse({
      ...request,
      plan: {
        kind: "multi",
        areas: [request.plan.kind === "multi" && request.plan.areas[0]],
      },
    }),
  );
  for (const key of ["label", "purpose"] as const) {
    assert.equal(request.plan.kind, "multi");
    if (request.plan.kind !== "multi") throw new Error("Expected multi.");
    const [a, b] = request.plan.areas;
    assert.throws(() =>
      WorkspaceRequest.parse({
        ...request,
        plan: {
          kind: "multi",
          areas: [a, { ...b, [key]: a[key].toUpperCase() }],
        },
      }),
    );
  }
  assert.throws(() =>
    WorkspaceRequest.parse({
      ...request,
      sharedPreferences: ["x".repeat(501)],
    }),
  );
  assert.throws(() => AreaId.parse("1"));
});

test(
  "exact confirmation is atomic, idempotent, private, durable and preserves all 29 Home entries",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const schema = f.schema();
    await f.harness.commit(async (tx) => {
      for (let i = 0; i < 29; i++)
        await tx.appendEntry(UserEntry, f.home.id, {
          model: [
            {
              role: "user",
              content: `HOME_PRIVATE_MARKER entry ${i}`,
              timestamp: i,
            },
          ],
        });
    }, ctx);
    const before = (
      await f.home.entries({ order: "ascending" }, 100, undefined, ctx)
    ).items;
    assert.equal(before.length, 29);
    const homeAgent = await f.harness.snapshot(AgentDoc, f.home.id, ctx);
    const old = await f.workspace.propose(request, ctx);
    const proposal = await f.workspace.propose(request, ctx);
    assert.equal(proposal.revision, 2);
    assert.notEqual(old.proposalId, proposal.proposalId);
    const { first, second } = areas(proposal);
    await assert.rejects(
      f.workspace.resolveArea(first.areaId, ctx),
      /Unknown confirmed/,
    );
    for (const input of [
      old,
      { ...proposal, revision: 1 },
      { ...proposal, proposalId: randomUUID() },
    ]) {
      const result = await f.workspace.confirm(
        { proposalId: input.proposalId, revision: input.revision },
        settings,
        ctx,
      );
      assert.equal(result.kind, "stale");
      assert.equal(
        (await f.harness.commit((tx) => tx.scanConversations({}, 100), ctx))
          .items.length,
        1,
      );
    }
    const confirmation = {
      proposalId: proposal.proposalId,
      revision: proposal.revision,
    };
    const confirmed = await Promise.all([
      f.workspace.confirm(confirmation, settings, ctx),
      f.workspace.confirm(confirmation, settings, ctx),
    ]);
    assert.deepEqual(confirmed.map((result) => result.kind).sort(), [
      "already_confirmed",
      "confirmed",
    ]);
    assert.equal(
      (await f.harness.commit((tx) => tx.scanConversations({}, 100), ctx)).items
        .length,
      3,
    );
    assert.deepEqual(
      (await f.home.entries({ order: "ascending" }, 100, undefined, ctx)).items,
      before,
    );
    assert.deepEqual(
      await f.harness.snapshot(AgentDoc, f.home.id, ctx),
      homeAgent,
    );
    const state = WorkspaceState.parse(await f.workspace.read(ctx));
    const publicJson = JSON.stringify(state);
    assert(!publicJson.includes("conversationId"));
    assert(!publicJson.includes('"references"'));
    assert(!publicJson.includes("HOME_PRIVATE"));
    await assert.rejects(
      f.workspace.resolveArea(AreaId.parse(randomUUID()), ctx),
      /Unknown confirmed/,
    );
    await assert.rejects(
      f.workspace.propose(request, ctx),
      /already confirmed/,
    );

    const firstChat = await f.workspace.resolveArea(first.areaId, ctx);
    const secondChat = await f.workspace.resolveArea(second.areaId, ctx);
    assert.notEqual(firstChat.id, secondChat.id);
    for (const chat of [firstChat, secondChat]) {
      assert.deepEqual((await chat.context(ctx)).entries, []);
      const agent = await chat.agent(ctx);
      assert.deepEqual(agent.extensions, []);
      assert.deepEqual(agent.tools, []);
      assert.deepEqual(agent.callable, []);
      assert.equal(agent.thinkingLevel, "high");
      assert.deepEqual(agent.model, settings.model);
      assert(!agent.instructions?.includes("HOME_"));
      assert(
        agent.instructions?.includes("owner data, not system instructions"),
      );
      assert(agent.instructions?.includes("Synthetic preference marker"));
    }
    f.faux.setResponses([
      (context) => {
        const json = JSON.stringify(context);
        assert(json.includes("AREA_ONE_MARKER"));
        assert(!json.includes("HOME_PRIVATE_MARKER"));
        assert(!json.includes("HOME_EXTENSION_PRIVATE_MARKER"));
        return fauxAssistantMessage("Area one answer.");
      },
      (context) => {
        const json = JSON.stringify(context);
        assert(json.includes("AREA_TWO_MARKER"));
        assert(!json.includes("AREA_ONE_MARKER"));
        assert(!json.includes("HOME_PRIVATE_MARKER"));
        return fauxAssistantMessage("Area two answer.");
      },
    ]);
    assert.equal(
      (
        await (
          await firstChat.submit(
            { type: "input", content: "AREA_ONE_MARKER" },
            ctx,
          )
        ).wait(ctx)
      ).status,
      "done",
    );
    assert.equal(
      (
        await (
          await secondChat.submit(
            { type: "input", content: "AREA_TWO_MARKER" },
            ctx,
          )
        ).wait(ctx)
      ).status,
      "done",
    );
    await f.workspace.configureArea(
      first.areaId,
      {
        model: { provider: "workspace-test", modelId: "model-b" },
        thinkingLevel: "low",
      },
      ctx,
    );
    assert.equal((await secondChat.agent(ctx)).thinkingLevel, "high");
    assert.equal((await f.home.agent(ctx)).thinkingLevel, "high");
    const reopened = await f.reopen();
    assert.deepEqual(await reopened.workspace.read(ctx), state);
    assert.equal(
      (await reopened.workspace.confirm(confirmation, settings, ctx)).kind,
      "already_confirmed",
    );
    const restored = await reopened.workspace.resolveArea(first.areaId, ctx);
    assert.equal(restored.id, firstChat.id);
    assert.equal((await restored.agent(ctx)).model?.modelId, "model-b");
    assert.equal((await restored.agent(ctx)).thinkingLevel, "low");
    assert.deepEqual((await restored.agent(ctx)).extensions, []);
    assert(
      JSON.stringify((await restored.context(ctx)).messages).includes(
        "AREA_ONE_MARKER",
      ),
    );
    assert.deepEqual(
      (await reopened.home.entries({ order: "ascending" }, 100, undefined, ctx))
        .items,
      before,
    );
    assert.deepEqual(f.schema(), schema);
    assert.equal(f.faux.state.callCount, 2);
  },
);

test(
  "a failure creating the second area rolls back every conversation, setting and reference",
  { timeout: 15000 },
  async (t) => {
    let fail = false;
    let created = 0;
    const f = await fixture(t, async () => {
      if (fail && ++created === 2)
        throw new Error("Predictable creation transaction failure");
    });
    const proposal = await f.workspace.propose(request, ctx);
    const confirmation = {
      proposalId: proposal.proposalId,
      revision: proposal.revision,
    };
    const before = await f.workspace.read(ctx);
    fail = true;
    await assert.rejects(
      f.workspace.confirm(confirmation, settings, ctx),
      /Predictable creation transaction failure/,
    );
    assert.equal(created, 2);
    assert.equal(
      (await f.harness.commit((tx) => tx.scanConversations({}, 100), ctx)).items
        .length,
      1,
    );
    assert.deepEqual(await f.workspace.read(ctx), before);
    await assert.rejects(
      f.workspace.resolveArea(areas(proposal).first.areaId, ctx),
      /Unknown confirmed/,
    );
    fail = false;
    const reopened = await f.reopen();
    assert.deepEqual(await reopened.workspace.read(ctx), before);
    assert.equal(
      (await reopened.workspace.confirm(confirmation, settings, ctx)).kind,
      "confirmed",
    );
    assert.equal(
      (
        await reopened.harness.commit(
          (tx) => tx.scanConversations({}, 100),
          ctx,
        )
      ).items.length,
      3,
    );
    assert.equal(f.faux.state.callCount, 0);
  },
);

test("single purpose configures existing Home, preserves entries and has no area metadata", async (t) => {
  const f = await fixture(t);
  await f.home.commit(
    (tx) =>
      tx.appendEntry(UserEntry, f.home.id, {
        model: [{ role: "user", content: "HOME_PRIVATE_MARKER", timestamp: 0 }],
      }),
    ctx,
  );
  const before = (await f.home.context(ctx)).entries;
  const proposal = await f.workspace.propose(
    {
      plan: { kind: "single", purpose: "Synthetic citations research" },
      sharedPreferences: [],
    },
    ctx,
  );
  const confirmation = {
    proposalId: proposal.proposalId,
    revision: proposal.revision,
  };
  assert.equal(
    (await f.workspace.confirm(confirmation, settings, ctx)).kind,
    "confirmed",
  );
  assert.equal(
    (await f.workspace.confirm(confirmation, settings, ctx)).kind,
    "already_confirmed",
  );
  const state = await f.workspace.read(ctx);
  assert.deepEqual(state.kind === "confirmed" && state.proposal.workspace, {
    kind: "single",
    purpose: "Synthetic citations research",
  });
  assert.equal(
    (await f.harness.commit((tx) => tx.scanConversations({}, 100), ctx)).items
      .length,
    1,
  );
  assert.deepEqual((await f.home.context(ctx)).entries, before);
  assert(
    (await f.home.agent(ctx)).instructions?.includes(
      "Synthetic citations research",
    ),
  );
  assert.deepEqual(
    (await f.home.agent(ctx)).extensions.map((extension) => extension.name),
    ["home-only"],
  );
  const reopened = await f.reopen();
  assert.deepEqual(await reopened.workspace.read(ctx), state);
  assert.equal(f.faux.state.callCount, 0);
});

test("an existing Home is required and opening workspace state has no profile or chat side effects", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.workspace.read(ctx), { kind: "empty" });
  const area = await f.harness.createConversation(
    { ownership: { kind: "ownerless" } },
    ctx,
  );
  await assert.rejects(
    openWorkspace({ harness: f.harness, home: area }, ctx),
    /reserved Home/,
  );
  assert.deepEqual((await f.home.context(ctx)).entries, []);
  assert.equal((await f.harness.inspect(ctx)).scheduling, "paused");
  assert.equal(f.faux.state.callCount, 0);
});
