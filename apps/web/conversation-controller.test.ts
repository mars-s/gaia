import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  createConversationController,
  stopScope,
  type ConversationController,
} from "./conversation-controller.ts";
import {
  homeScope,
  scopeKey,
  type ConversationScope,
} from "./workspace-controller.ts";
import { AreaId, type WorkspaceState } from "../../packages/sdk/workspace.ts";
import {
  areaSnapshot,
  deferred,
  firstArea,
  homeSnapshot,
  memoryDrafts,
  multiWorkspace,
  proposalId,
  secondArea,
  settle,
} from "./conversation-fixtures.ts";
import type { ChatDraft } from "./chat-draft.ts";
import { createReleaseObserver } from "./renderer-release.ts";
import { command } from "../../packages/sdk/index.ts";
import { uploadImage } from "../../packages/sdk/images.ts";
import {
  areaCommand,
  confirmWorkspace,
  readArea,
  readWorkspace,
  uploadAreaImage,
} from "../../packages/sdk/workspace-client.ts";
import { readImageFiles } from "./image-input.ts";

const areaA = { kind: "area", areaId: firstArea } satisfies ConversationScope;
const areaB = { kind: "area", areaId: secondArea } satisfies ConversationScope;
type Call = { path: string; body: unknown; signal?: AbortSignal | null };
async function harness(
  t: TestContext,
  options: Parameters<typeof createConversationController>[0] = {},
) {
  const calls: Call[] = [];
  let workspace: WorkspaceState = multiWorkspace();
  let reply: (call: Call) => Promise<Response | undefined> = async () =>
    undefined;
  const areaStates = new Map([
    [firstArea, areaSnapshot()],
    [secondArea, areaSnapshot(secondArea)],
  ]);
  const home = homeSnapshot();
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const call = {
        path,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        signal: init?.signal,
      };
      calls.push(call);
      const custom = await reply(call);
      if (custom) return custom;
      if (path === "/api/v1/workspace") return Response.json(workspace);
      const match = /^\/api\/v1\/areas\/([^/]+)\//.exec(path);
      if (match) return Response.json(areaStates.get(AreaId.parse(match[1])));
      return Response.json(home);
    },
  );
  const drafts = memoryDrafts();
  const controller = createConversationController({
    persistence: (scope) => drafts.store(scopeKey(scope)),
    legacy: "Unsent Home",
    ...options,
  });
  t.after(() => controller.pause());
  controller.resume();
  controller.receiveHome(home);
  await settle();
  return {
    controller,
    calls,
    drafts,
    areaStates,
    home,
    setWorkspace(value: WorkspaceState) {
      workspace = value;
    },
    respond(value: typeof reply) {
      reply = value;
    },
  };
}
function draft(
  controller: ConversationController,
  scope: ConversationScope,
): ChatDraft {
  const value = controller.session(scope).draft.read();
  assert(value.kind === "ready");
  return value.draft;
}

test("area endpoints receive exact scope payloads and delayed send completion retains newer and other-scope drafts", async (t) => {
  const h = await harness(t);
  const { controller: c } = h;
  assert(c.workspace.ready());
  c.select(areaA);
  await settle();
  c.session(areaA).draft.update((value) => ({
    ...value,
    text: "Study question",
  }));
  assert(c.canSend(areaA));
  const sent = draft(c, areaA);
  const response = deferred<Response>();
  h.respond(async ({ path }) =>
    path.endsWith(`/${firstArea}/messages`) ? response.promise : undefined,
  );
  const sending = c.send(areaA);
  c.select(areaB);
  await settle();
  c.session(areaB).draft.update((value) => ({
    ...value,
    text: "Garden draft",
  }));
  c.session(areaA).draft.update((value) => ({
    ...value,
    text: "New study edit",
  }));
  assert(!c.canSend(homeScope));
  assert(!(await c.act(areaB, "compact")));
  assert(!c.prepareReload());
  response.resolve(Response.json(areaSnapshot()));
  assert(await sending);
  await settle();
  assert.equal(draft(c, areaA).text, "New study edit");
  assert.equal(draft(c, areaB).text, "Garden draft");
  assert.equal(draft(c, homeScope).text, "Unsent Home");
  const sentCalls = h.calls.filter((call) => call.path.endsWith("/messages"));
  assert.deepEqual(
    sentCalls.map(({ path, body }) => ({ path, body })),
    [
      {
        path: `/api/v1/areas/${firstArea}/messages`,
        body: { requestId: sent.requestId, text: "Study question" },
      },
    ],
  );
  assert.equal(
    c.view(areaB)?.thread.messages.length,
    0,
    "Area history never falls back to Home.",
  );
  h.respond(async () => undefined);
  for (const action of ["retry", "compact"] as const)
    assert(await c.act(areaA, action));
  assert(
    await c.act(areaA, "model", {
      modelId: "area-model",
      thinkingLevel: "high",
    }),
  );
  assert.deepEqual(
    h.calls
      .filter((call) => /\/(retry|compact|model)$/.test(call.path))
      .map(({ path, body }) => ({ path, body })),
    [
      { path: `/api/v1/areas/${firstArea}/retry`, body: {} },
      { path: `/api/v1/areas/${firstArea}/compact`, body: {} },
      {
        path: `/api/v1/areas/${firstArea}/model`,
        body: { modelId: "area-model", thinkingLevel: "high" },
      },
    ],
  );
});

test("Home is blocked by direct area work and Stop follows Home routing ownership", async (t) => {
  const h = await harness(t);
  const c = h.controller;
  const active = areaSnapshot();
  active.thread.run = { kind: "running", id: "direct" };
  h.areaStates.set(firstArea, active);
  await c.workspace.refreshArea(firstArea);
  assert.equal(c.home?.thread.run.kind, "idle");
  assert(!c.canSend(homeScope));
  assert(!(await c.send(homeScope)));
  assert.equal(stopScope(c.home, homeScope, c.home?.thread), undefined);
  assert.deepEqual(stopScope(c.home, areaA, active.thread), areaA);
  assert(await c.stop(areaA));
  assert.equal(
    h.calls.filter((call) => call.path.endsWith("/stop")).at(-1)?.path,
    `/api/v1/areas/${firstArea}/stop`,
  );
  const routedHome = homeSnapshot();
  routedHome.thread.run = { kind: "running", id: "routing" };
  c.receiveHome(routedHome);
  assert.deepEqual(stopScope(c.home, areaA, active.thread), homeScope);
  assert(await c.stop(areaA));
  assert.equal(
    h.calls.filter((call) => call.path.endsWith("/stop")).at(-1)?.path,
    "/api/v1/stop",
  );
  assert(!h.calls.some((call) => call.path === "/api/v1/messages"));
});

test("area upload failure preserves bytes and request identity, and switching cannot upload or send into Home", async (t) => {
  const h = await harness(t);
  const c = h.controller;
  const area = areaSnapshot();
  area.chat.models[0].capabilities = {
    images: true,
    thinkingLevels: ["low", "high"],
  };
  h.areaStates.set(firstArea, area);
  c.select(areaA);
  await settle();
  await c.addImages(areaA, [
    new File(["retained image bytes"], "study.png", { type: "image/png" }),
  ]);
  const before = structuredClone(draft(c, areaA));
  h.respond(async ({ path }) =>
    path.endsWith("/attachments")
      ? Response.json({ error: "Image preparation failed" }, { status: 503 })
      : undefined,
  );
  const sending = c.send(areaA);
  c.select(homeScope);
  assert(!(await sending));
  await settle();
  assert.deepEqual(draft(c, areaA), before);
  assert.equal(draft(c, homeScope).images.length, 0);
  assert.equal(c.session(areaA).error, "Image preparation failed");
  assert(
    h.calls.some(
      (call) => call.path === `/api/v1/areas/${firstArea}/attachments`,
    ),
  );
  assert(
    !h.calls.some(
      (call) =>
        call.path === "/api/v1/attachments" || call.path.endsWith("/messages"),
    ),
  );
  const restored = createConversationController({
    persistence: (scope) => h.drafts.store(scopeKey(scope)),
  });
  await restored.session(areaA).draft.load();
  assert.deepEqual(draft(restored, areaA), before);
});

test("release reload waits for unmounted image reads, saves, IME and pending latest model selection", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const read = deferred<Awaited<ReturnType<typeof readImageFiles>>>();
  const delayedSave = deferred<void>();
  const memory = memoryDrafts();
  let blockSave = false;
  const h = await harness(t, {
    api: {
      command,
      areaCommand,
      uploadImage,
      uploadAreaImage,
      confirmWorkspace,
      readArea,
      readWorkspace,
      readImageFiles: () => read.promise,
    },
    persistence: (scope) => {
      const store = memory.store(scopeKey(scope));
      return {
        ...store,
        async save(value) {
          if (blockSave && scope.kind === "home") await delayedSave.promise;
          await store.save(value);
        },
      };
    },
  });
  const c = h.controller;
  const reading = c.addImages(homeScope, [
    new File(["x"], "x.png", { type: "image/png" }),
  ]);
  c.select(areaA);
  await settle();
  let reloads = 0;
  const observe = createReleaseObserver(
    c.prepareReload,
    () => {
      reloads++;
    },
    "old",
  );
  assert(observe("new"));
  assert.equal(reloads, 0);
  blockSave = true;
  const image = {
    id: crypto.randomUUID(),
    name: "x.png",
    mimeType: "image/png" as const,
    data: btoa("real bytes"),
  };
  read.resolve([image]);
  await reading;
  await settle();
  assert(observe("new"));
  delayedSave.resolve();
  await settle();
  assert.equal(draft(c, homeScope).images[0]?.data, image.data);
  c.compose(areaA, true);
  assert(observe("new"));
  assert(!c.canSend(areaA));
  c.compose(areaA, false);
  const first = deferred<Response>();
  let modelCalls = 0;
  h.respond(async ({ path }) => {
    if (!path.endsWith("/model")) return undefined;
    modelCalls++;
    if (modelCalls === 1) return first.promise;
    const committed = areaSnapshot();
    committed.chat.thinkingLevel = "high";
    h.areaStates.set(firstArea, committed);
    return Response.json(committed);
  });
  c.session(areaA).queue.select({
    modelId: "area-model",
    thinkingLevel: "low",
  });
  assert(!c.canSend(homeScope));
  t.mock.timers.tick(150);
  await settle();
  c.session(areaA).queue.select({
    modelId: "area-model",
    thinkingLevel: "high",
  });
  c.select(homeScope);
  await settle();
  assert(observe("new"));
  first.resolve(Response.json(areaSnapshot()));
  await settle();
  assert(observe("new"), "The latest unmounted choice must still commit.");
  t.mock.timers.tick(150);
  await settle();
  assert.equal(modelCalls, 2);
  assert.equal(c.view(areaA)?.chat?.thinkingLevel, "high");
  assert.deepEqual(
    h.calls
      .filter((call) => call.path.endsWith("/model"))
      .map((call) => call.body),
    [
      { modelId: "area-model", thinkingLevel: "low" },
      { modelId: "area-model", thinkingLevel: "high" },
    ],
  );
  assert(!observe("new"));
  assert.equal(reloads, 1);
});

test("only exact owner confirmation writes setup, stale proposals refresh and typed yes remains a Home message", async (t) => {
  const h = await harness(t);
  const c = h.controller;
  h.setWorkspace({
    kind: "proposed",
    proposal: {
      proposalId,
      revision: 8,
      workspace: { kind: "single", purpose: "Research" },
      sharedPreferences: ["Cite primary sources"],
    },
  });
  await c.workspace.refresh();
  c.session(homeScope).draft.update((value) => ({ ...value, text: "yes" }));
  assert(await c.send(homeScope));
  assert(!h.calls.some((call) => call.path.endsWith("/confirm")));
  assert(!(await c.confirm({ proposalId, revision: 7 })));
  assert(!h.calls.some((call) => call.path.endsWith("/confirm")));
  h.respond(async ({ path, body }) => {
    if (path !== "/api/v1/workspace/confirm") return undefined;
    assert.deepEqual(body, { proposalId, revision: 8 });
    const current = c.workspace.state;
    assert(current?.kind === "proposed");
    h.setWorkspace({ ...current, kind: "confirmed" });
    return Response.json({
      kind: "confirmed",
      workspace: current.proposal.workspace,
    });
  });
  assert(await c.confirm({ proposalId, revision: 8 }));
  assert.equal(c.workspace.state?.kind, "confirmed");
  assert.equal(c.workspace.areaList().length, 0);
  assert.equal(c.selected.kind, "home");
});

test("late Home command snapshots cannot replace newer SSE state or undo an offline signal", async (t) => {
  const h = await harness(t);
  const c = h.controller;
  const first = deferred<Response>();
  h.respond(async ({ path }) =>
    path === "/api/v1/messages" ? first.promise : undefined,
  );
  const sending = c.send(homeScope);
  const newer = homeSnapshot();
  newer.thread.messages.push({
    id: "completed",
    role: "assistant",
    text: "Latest streamed answer",
    createdAt: "now",
  });
  c.receiveHome(newer);
  first.resolve(Response.json(homeSnapshot()));
  assert(await sending);
  assert.equal(c.home?.thread.messages.at(-1)?.text, "Latest streamed answer");
  c.session(homeScope).draft.update((value) => ({
    ...value,
    text: "Next question",
  }));
  const second = deferred<Response>();
  h.respond(async ({ path }) =>
    path === "/api/v1/messages" ? second.promise : undefined,
  );
  const next = c.send(homeScope);
  c.setOffline();
  second.resolve(Response.json(homeSnapshot()));
  assert(await next);
  assert(c.offline);
  assert.equal(c.home?.thread.messages.at(-1)?.text, "Latest streamed answer");
});

test("a proposal replaced at the server returns the latest review card and retains the Home draft", async (t) => {
  const h = await harness(t);
  const c = h.controller;
  const original: WorkspaceState = {
    kind: "proposed",
    proposal: {
      proposalId,
      revision: 2,
      workspace: { kind: "single", purpose: "Original purpose" },
      sharedPreferences: [],
    },
  };
  h.setWorkspace(original);
  await c.workspace.refresh();
  h.respond(async ({ path }) => {
    if (path !== "/api/v1/workspace/confirm") return undefined;
    h.setWorkspace({
      ...original,
      proposal: {
        ...original.proposal,
        proposalId: "44444444-4444-4444-8444-444444444444",
        revision: 3,
        workspace: { kind: "single", purpose: "Replacement purpose" },
      },
    });
    return Response.json(
      { error: "Proposal replaced. Review the current setup." },
      { status: 409 },
    );
  });
  assert(!(await c.confirm({ proposalId, revision: 2 })));
  assert.equal(
    c.workspace.state?.kind === "proposed" &&
      c.workspace.state.proposal.revision,
    3,
  );
  assert.equal(
    c.session(homeScope).error,
    "Proposal replaced. Review the current setup.",
  );
  assert.equal(draft(c, homeScope).text, "Unsent Home");
});

test("a Home turn completed between snapshots still refreshes the schema-validated workspace proposal", async (t) => {
  const h = await harness(t);
  h.setWorkspace({
    kind: "proposed",
    proposal: {
      proposalId,
      revision: 9,
      workspace: { kind: "single", purpose: "Research" },
      sharedPreferences: [],
    },
  });
  const completed = homeSnapshot();
  completed.thread.messages.push({
    id: "fast-turn",
    role: "assistant",
    text: "Review the proposed setup.",
    createdAt: "now",
  });
  h.controller.receiveHome(completed);
  await settle();
  const state = h.controller.workspace.state;
  assert.equal(state?.kind === "proposed" && state.proposal.revision, 9);
  assert(!h.calls.some((call) => call.path.endsWith("/confirm")));
});

test("server-reported model changes also block release reload after a client request has settled", async (t) => {
  const h = await harness(t);
  const c = h.controller;
  await settle();
  assert(c.prepareReload());
  const modelChange = homeSnapshot();
  modelChange.thread.run = { kind: "running", id: "model", operation: "model" };
  c.receiveHome(modelChange);
  assert(!c.prepareReload());
  c.receiveHome(homeSnapshot());
  await settle();
  assert(c.prepareReload());
  const areaChange = areaSnapshot();
  areaChange.thread.run = {
    kind: "running",
    id: "area-model",
    operation: "model",
  };
  h.areaStates.set(firstArea, areaChange);
  await c.workspace.refreshArea(firstArea);
  assert(!c.prepareReload());
  h.areaStates.set(firstArea, areaSnapshot());
  await c.workspace.refreshArea(firstArea);
  assert(c.prepareReload());
});
