import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ExperienceId,
  ScopeId,
  JobId,
  ExperienceScopeState,
  ExperienceState,
  type ExperienceLayout,
  type ExperienceJob,
} from "../../packages/protocol/experiences.ts";
import {
  createExperienceClient,
  type ExperienceClient,
} from "../../packages/sdk/experiences.ts";
import {
  createExperienceController,
  experienceKey,
  keyboardSend,
} from "./experiences/controller";
import { ChatDraft, type DraftPersistence } from "./chat-draft";

const pid = ExperienceId.parse("11111111-1111-4111-8111-111111111111");
const other = ExperienceId.parse("22222222-2222-4222-8222-222222222222");
const sid = ScopeId.parse("33333333-3333-4333-8333-333333333333");
const second = ScopeId.parse("44444444-4444-4444-8444-444444444444");
const jid = JobId.parse("55555555-5555-4555-8555-555555555555");
const scope = { profileId: pid, scopeId: sid };
const job: ExperienceJob = {
  id: jid,
  profileId: pid,
  scopeId: sid,
  requestId: crypto.randomUUID(),
  messageId: "user",
  answerId: "answer",
  title: "Check fixture",
  contextRevision: 0,
  state: {
    kind: "running",
    startedAt: "now",
    activity: [
      {
        id: "activity",
        callId: "call",
        description: "Checking the fixture",
        kind: "file",
      },
    ],
  },
};
const caps = {
  machine: false,
  desktop: false,
  search: false,
  selfModification: false,
};
function state(profileId = pid, scopeId = sid, revision = 1) {
  return ExperienceScopeState.parse({
    version: 1,
    profileId,
    scope: {
      id: scopeId,
      profileId,
      label: "Main",
      purpose: "Test",
      createdAt: "now",
    },
    revision,
    messages: [],
    jobs: profileId === pid && scopeId === sid ? [job] : [],
    chat: {
      models: [
        {
          id: "model",
          name: "Model",
          contextWindow: 1000,
          capabilities: { images: true, thinkingLevels: ["high"] },
        },
      ],
      modelId: "model",
      thinkingLevel: "high",
      compaction: { kind: "idle" },
    },
    memoryRevision: 0,
  });
}
function profile(layout: ExperienceLayout = "single", profileId = pid) {
  return ExperienceState.parse({
    version: 1,
    profile: {
      id: profileId,
      revision: 7,
      kind: "ready",
      plan: {
        layout,
        title: "Test",
        assistantName: "Gaia",
        purpose: "Test",
        scopes: [{ label: "Main", purpose: "Test" }],
      },
    },
    revision: 1,
    scopes: [state(profileId).scope, state(profileId, second).scope],
    jobs: [],
    capabilities: caps,
  });
}
function harness(
  overrides: Partial<ExperienceClient> = {},
  store = new Map<string, unknown>(),
) {
  const streams: {
    receive: (value: ExperienceScopeState) => void;
    closed: boolean;
  }[] = [];
  const client: ExperienceClient = {
    ...createExperienceClient(),
    state: async (id) => profile("bots", id),
    scope: async (id, sid) => state(id, sid, 9),
    subscribe: (_pid, _sid, receive) => {
      const stream = { receive, closed: false };
      streams.push(stream);
      return () => {
        stream.closed = true;
      };
    },
    ...overrides,
  };
  const persistence = (key: string): DraftPersistence => ({
    load: async () => store.get(key),
    save: async (draft) => {
      store.set(key, structuredClone(draft));
    },
  });
  return {
    controller: createExperienceController({ client, persistence }),
    streams,
    store,
  };
}
const ready = () => new Promise<void>((resolve) => setImmediate(resolve));

test("stale index reads cannot hide a new proposal or undo confirmation", async () => {
  const pending = deferred<Awaited<ReturnType<ExperienceClient["index"]>>>();
  const proposed = ExperienceState.parse({
    ...profile(),
    profile: { ...profile().profile, kind: "proposed" },
  });
  const { controller } = harness({
    index: async () => pending.promise,
    create: async () => proposed.profile,
    state: async () => proposed,
    confirm: async () => profile(),
  });
  const stale = controller.refresh();
  assert.equal(await controller.propose(proposed.profile.plan), true);
  pending.resolve({ version: 1, profiles: [], capabilities: caps });
  await stale;
  assert.deepEqual(
    controller.profiles.map((item) => item.id),
    [pid],
  );
  const earlier = deferred<Awaited<ReturnType<ExperienceClient["index"]>>>();
  controller.client.index = async () => earlier.promise;
  const refresh = controller.refresh();
  assert.equal(await controller.confirm(proposed.profile), true);
  earlier.resolve({
    version: 1,
    profiles: [proposed.profile],
    capabilities: caps,
  });
  await refresh;
  assert.equal(controller.profiles[0].kind, "ready");
  controller.pause();
});

test("failed creation reports failure and retries the same proposal identity", async () => {
  const identities: string[] = [];
  const proposed = ExperienceState.parse({
    ...profile(),
    profile: { ...profile().profile, kind: "proposed" },
  });
  let fail = true;
  const { controller } = harness({
    create: async (input) => {
      identities.push(input.requestId);
      if (fail) throw new Error("Synthetic unavailable response");
      return proposed.profile;
    },
    state: async () => proposed,
    createScope: async () => {
      throw new Error("Synthetic scope creation failure");
    },
  });
  assert.equal(await controller.propose(proposed.profile.plan), false);
  fail = false;
  assert.equal(await controller.propose(proposed.profile.plan), true);
  assert.equal(identities[0], identities[1]);
  controller.profile = profile("bots");
  assert.equal(
    await controller.createScope("Keep this name", "Keep this purpose"),
    false,
  );
  assert.equal(controller.profile.scopes.length, 2);
  controller.pause();
});

test("a late proposal does not replace a newer selected profile", async () => {
  const create = deferred<Awaited<ReturnType<ExperienceClient["create"]>>>();
  const { controller } = harness({ create: async () => create.promise });
  const pending = controller.propose(profile().profile.plan);
  await controller.selectProfile(other);
  create.resolve(profile().profile);
  assert.equal(await pending, true);
  assert.equal(controller.profile?.profile.id, other);
  assert.equal(controller.selected?.profileId, other);
  controller.pause();
});

test("concurrent jobs do not block sending; failed admission and new edits retain scoped images", async () => {
  const admission = deferred<Awaited<ReturnType<ExperienceClient["send"]>>>();
  let sends = 0;
  const { controller } = harness({
    send: async () => {
      sends++;
      return admission.promise;
    },
    upload: async (_p, _s, image) => ({
      id: image.id,
      name: "image",
      mimeType: image.mimeType,
      size: 1,
    }),
  });
  await controller.selectProfile(pid);
  controller.receive(scope, state());
  await ready();
  const entry = controller.entry(scope);
  entry.draft.update(() => ({
    text: "First",
    images: [
      {
        id: crypto.randomUUID(),
        name: "Image",
        mimeType: "image/png",
        data: "YWJj",
      },
    ],
  }));
  assert.equal(controller.canSend(scope), true);
  const sending = controller.send(scope);
  await ready();
  entry.draft.update((draft) => ({ ...draft, text: "New edit" }));
  admission.resolve({
    profileId: pid,
    scopeId: sid,
    messageId: "user",
    jobId: jid,
    state: job.state,
  });
  await sending;
  const retained = entry.draft.read();
  assert.equal(retained.kind, "ready");
  if (retained.kind === "ready") {
    assert.equal(retained.draft.text, "New edit");
    assert.equal(retained.draft.images.length, 1);
  }
  assert.equal(sends, 1);
  assert.equal(controller.canSend(scope), true);
  controller.pause();
  const failed = harness({
    send: async () => {
      throw new Error("Admission refused");
    },
  }).controller;
  await failed.selectProfile(pid);
  failed.receive(scope, state());
  await ready();
  failed.entry(scope).draft.update(() => ({ text: "Keep", images: [] }));
  await failed.send(scope);
  assert.equal(failed.entry(scope).error, "Admission refused");
  assert.equal(failed.canSend(scope), true);
  failed.pause();
});

test("late profile, old streams and lower revisions cannot replace newer selection", async () => {
  const slow = deferred<ExperienceState>();
  const { controller, streams } = harness({
    state: async (id) => (id === pid ? slow.promise : profile("channels", id)),
  });
  const pending = controller.selectProfile(pid);
  await controller.selectProfile(other);
  slow.resolve(profile());
  await pending;
  assert.equal(controller.profile?.profile.id, other);
  const previous = streams[0];
  controller.select({ profileId: other, scopeId: second });
  previous?.receive(state(other));
  assert.equal(controller.selected?.scopeId, second);
  assert.equal(previous?.closed, true);
  const selected = { profileId: other, scopeId: second };
  controller.receive(selected, state(other, second, 5));
  controller.receive(selected, state(other, second, 2));
  assert.equal(controller.entry(selected).state?.revision, 5);
  controller.receive(selected, state(pid, second, 10));
  assert.equal(controller.entry(selected).state?.revision, 5);
  controller.pause();
});

test("draft and image storage includes profile and scope; reload waits for durable writes", async () => {
  const { controller, store } = harness();
  const a = controller.entry(scope);
  const bscope = { profileId: other, scopeId: sid };
  const b = controller.entry(bscope);
  await ready();
  a.draft.update(() => ({
    text: "Private",
    images: [
      {
        id: crypto.randomUUID(),
        name: "photo",
        mimeType: "image/png",
        data: "YWJj",
      },
    ],
  }));
  b.draft.update(() => ({ text: "Other", images: [] }));
  await ready();
  assert.notEqual(experienceKey(scope), experienceKey(bscope));
  assert.equal(controller.prepareReload(), true);
  controller.pause();
  const reopened = harness({}, store).controller;
  const draft = reopened.entry(scope).draft;
  await ready();
  const saved = draft.read();
  assert.equal(saved.kind, "ready");
  if (saved.kind === "ready") {
    assert.equal(saved.draft.text, "Private");
    assert.equal(saved.draft.images.length, 1);
  }
  reopened.pause();
});

test("storage failure keeps draft in memory and blocks release reload until save recovers", async () => {
  let fail = true;
  const controller = createExperienceController({
    persistence: () => ({
      load: async () => undefined,
      save: async () => {
        if (fail) throw Error("disk");
      },
    }),
  });
  const entry = controller.entry(scope);
  await ready();
  entry.draft.update(() => ({ text: "Keep me", images: [] }));
  await ready();
  assert.equal(controller.prepareReload(), false);
  fail = false;
  entry.draft.retrySave();
  await ready();
  assert.equal(controller.prepareReload(), true);
  controller.pause();
});

test("stop binds exact job; uncertain retry requires explicit repeat confirmation", async () => {
  const calls: string[] = [];
  const { controller } = harness({
    stop: async (_p, id) => {
      calls.push(`stop:${id}`);
      return {
        ...job,
        state: { kind: "stopped", finishedAt: "now", partialText: "" },
      };
    },
    retry: async (_p, id, input) => {
      calls.push(`retry:${id}:${input.repeatUncertain}`);
      return {
        profileId: pid,
        scopeId: sid,
        messageId: "user",
        jobId: jid,
        state: job.state,
      };
    },
  });
  const uncertain: ExperienceJob = {
    ...job,
    state: {
      kind: "uncertain",
      interruptedAt: "now",
      message: "May have run",
      partialText: "",
      invocationIds: ["one"],
    },
  };
  await controller.retry(scope, uncertain);
  assert.equal(calls.length, 0);
  await controller.retry(scope, uncertain, true);
  await controller.stop(scope, job);
  await controller.stop({ profileId: other, scopeId: sid }, job);
  assert.deepEqual(calls, [`retry:${jid}:true`, `stop:${jid}`]);
  controller.pause();
});

test("model changes queue in order per scope, keep latest intent, and cancel timers on pause", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const held = deferred<ExperienceScopeState>();
  const calls: string[] = [];
  const { controller } = harness({
    model: async (_p, _s, selection) => {
      calls.push(selection.modelId);
      return calls.length === 1 ? held.promise : state(pid, sid, 3);
    },
  });
  controller.selectModel(scope, { modelId: "first" });
  t.mock.timers.tick(151);
  await ready();
  controller.selectModel(scope, { modelId: "second" });
  controller.selectModel(scope, { modelId: "last" });
  held.resolve(state(pid, sid, 2));
  await ready();
  t.mock.timers.tick(151);
  await ready();
  assert.deepEqual(calls, ["first", "last"]);
  assert.equal(controller.entry(scope).selection, undefined);
  controller.selectModel(scope, { modelId: "cancelled" });
  controller.pause();
  t.mock.timers.tick(1000);
  assert.deepEqual(calls, ["first", "last"]);
});

test("confirmation uses exact displayed revision and only selects created scope after success", async () => {
  let revision = -1;
  let creates = 0;
  const proposed = profile("sessions");
  proposed.profile.kind = "proposed";
  const { controller } = harness({
    state: async () => proposed,
    confirm: async (_p, value) => {
      revision = value;
      return profile("sessions");
    },
    createScope: async () => {
      creates++;
      return { ...state().scope, id: ScopeId.parse(crypto.randomUUID()) };
    },
  });
  await controller.selectProfile(pid);
  assert.equal(Boolean(controller.selected), false);
  await controller.confirm(proposed.profile);
  assert.equal(revision, 7);
  const original = controller.profile?.scopes[0]?.id;
  await controller.createScope("New session", "Fresh");
  assert.equal(creates, 1);
  assert.notEqual(controller.selected?.scopeId, original);
  assert.equal(controller.profile?.scopes[0]?.id, original);
  controller.profile = profile("single");
  await controller.createScope("No", "No");
  assert.equal(creates, 1);
  controller.pause();
});

test("keyboard send respects Shift, IME native composition and keyCode 229", () => {
  const input = {
    key: "Enter",
    shiftKey: false,
    isComposing: false,
    keyCode: 13,
  };
  assert.equal(keyboardSend(input), true);
  for (const change of [
    { shiftKey: true },
    { isComposing: true },
    { keyCode: 229 },
    { key: "a" },
  ])
    assert.equal(keyboardSend({ ...input, ...change }), false);
  assert.equal(
    ChatDraft.safeParse({
      requestId: crypto.randomUUID(),
      text: "ok",
      images: [],
    }).success,
    true,
  );
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw Error("Promise not initialised");
  };
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("a delayed scope creation never pulls the owner away from a newer scope selection", async () => {
  const result =
    deferred<Awaited<ReturnType<ExperienceClient["createScope"]>>>();
  const { controller } = harness({ createScope: async () => result.promise });
  await controller.selectProfile(pid);
  const pending = controller.createScope("Fresh", "Fresh");
  controller.select({ profileId: pid, scopeId: second });
  result.resolve({ ...state().scope, id: ScopeId.parse(crypto.randomUUID()) });
  await pending;
  assert.equal(controller.selected?.scopeId, second);
  assert.equal(controller.profile?.scopes.length, 3);
  controller.pause();
});

test("pause closes the selected stream and resume replaces it without clearing the draft", async () => {
  const { controller, streams } = harness();
  await controller.selectProfile(pid);
  await ready();
  controller
    .entry(scope)
    .draft.update(() => ({ text: "Keep across reconnect", images: [] }));
  controller.pause();
  assert.equal(streams[0]?.closed, true);
  controller.resume();
  assert.equal(streams.length, 2);
  streams[0]?.receive(state(pid, sid, 50));
  assert.equal(controller.entry(scope).state?.revision, undefined);
  streams[1]?.receive(state(pid, sid, 2));
  assert.equal(controller.entry(scope).state?.revision, 2);
  const draft = controller.entry(scope).draft.read();
  if (draft.kind === "ready")
    assert.equal(draft.draft.text, "Keep across reconnect");
  else assert.fail("Draft unavailable");
  controller.pause();
});

test("started effects require confirmation and only flagged jobs send repeatEffects", async () => {
  const requests: unknown[] = [];
  const { controller } = harness({
    retry: async (_p, _j, input) => {
      requests.push(input);
      return {
        profileId: pid,
        scopeId: sid,
        messageId: "user",
        jobId: jid,
        state: job.state,
      };
    },
  });
  const completed: ExperienceJob = {
    ...job,
    dispatchedEffect: true,
    state: {
      kind: "completed",
      finishedAt: "now",
      text: "Done",
      citations: [],
    },
  };
  await controller.retry(scope, completed);
  await controller.retry(scope, completed, true);
  assert.equal(requests.length, 0);
  await controller.retry(scope, completed, false, true);
  assert.deepEqual(Object.keys(requests[0]!).sort(), [
    "repeatEffects",
    "requestId",
  ]);
  const uncertain: ExperienceJob = {
    ...completed,
    state: {
      kind: "uncertain",
      interruptedAt: "now",
      partialText: "",
      message: "Review",
      invocationIds: ["one"],
    },
  };
  await controller.retry(scope, uncertain, false, true);
  assert.equal(requests.length, 1);
  await controller.retry(scope, uncertain, true, true);
  assert.deepEqual(Object.keys(requests[1]!).sort(), [
    "repeatUncertain",
    "requestId",
  ]);
  const legacy = { ...completed };
  delete legacy.dispatchedEffect;
  await controller.retry(scope, legacy, false, true);
  assert.deepEqual(Object.keys(requests[2]!), ["requestId"]);
  controller.pause();
});
