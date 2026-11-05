import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { ExperienceScopeState } from "../../packages/protocol/experiences.ts";
import {
  ExperienceRequestError,
  createExperienceClient,
} from "../../packages/sdk/experiences.ts";
import { experienceFixture, deferred } from "../server/testing/experiences.ts";
import {
  createExperienceController,
  type SelectionPersistence,
} from "./experiences/controller.ts";

function preference(initial?: unknown) {
  let saved = initial;
  const persistence: SelectionPersistence = {
    load: () => saved,
    save: (value) => {
      saved = structuredClone(value);
    },
  };
  return { persistence, read: () => saved };
}
function controllerFor(
  f: Awaited<ReturnType<typeof experienceFixture>>,
  selection: SelectionPersistence,
) {
  const streams: {
    receive: (value: ExperienceScopeState) => void;
    closed: boolean;
  }[] = [];
  const drafts = new Map<string, unknown>();
  const client = createExperienceClient({
    fetch: (url, init) => fetch(new URL(String(url), f.base), init),
    events: () => {
      throw Error("Subscriptions are supplied by the test");
    },
  });
  client.main = async () => {
    throw new ExperienceRequestError(404, "Old server");
  };
  client.subscribe = (_p, _s, receive) => {
    const stream = { receive, closed: false };
    streams.push(stream);
    return () => {
      stream.closed = true;
    };
  };
  return {
    controller: createExperienceController({
      client,
      selectionPersistence: selection,
      persistence: (key) => ({
        load: async () => drafts.get(key),
        save: async (value) => {
          drafts.set(key, value);
        },
      }),
    }),
    streams,
    client,
  };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("session selection reload restores the exact confirmed pair and keeps drafts separate", async (t) => {
  const f = await experienceFixture(t);
  const profile = await f.confirm("sessions");
  const p = profile.profile.id;
  const [first, second] = profile.scopes;
  const saved = preference();
  const { controller, streams } = controllerFor(f, saved.persistence);
  t.after(() => controller.pause());
  assert.equal(await controller.restoreSelection(), false);
  assert.equal(controller.profile, undefined);
  await controller.selectProfile(p);
  const a = { profileId: p, scopeId: first.id };
  const b = { profileId: p, scopeId: second.id };
  await tick();
  controller
    .entry(a)
    .draft.update(() => ({ text: "First private draft", images: [] }));
  controller.select(b);
  await tick();
  controller
    .entry(b)
    .draft.update(() => ({ text: "Second private draft", images: [] }));
  streams[0].receive(await f.scope(p, first.id));
  assert.equal(controller.entry(a).state, undefined);
  assert.equal(streams[0].closed, true);
  for (const [scope, text] of [
    [a, "First private draft"],
    [b, "Second private draft"],
  ] as const) {
    controller.select(scope);
    const value = controller.entry(scope).draft.read();
    assert.equal(value.kind, "ready");
    if (value.kind === "ready") assert.equal(value.draft.text, text);
  }
  controller.selectModel(b, { modelId: "second", thinkingLevel: "low" });
  for (
    let attempt = 0;
    controller.entry(b).selection && attempt < 500;
    attempt++
  )
    await setTimeout(10);
  assert.equal(controller.entry(b).selection, undefined);
  const selectedState = await f.scope(p, second.id);
  assert.equal(selectedState.chat.modelId, "second");
  assert.equal(selectedState.chat.thinkingLevel, "low");
  assert.equal((await f.scope(p, first.id)).chat.modelId, "gpt-6.1-sol");
  assert.equal((await f.scope(p, first.id)).chat.thinkingLevel, "high");
  controller.select(
    Object.assign({}, b, { transcript: "Do not store transcript bytes" }),
  );
  controller.pause();
  assert.deepEqual(saved.read(), { version: 1, selected: b });
  const reopened = controllerFor(f, saved.persistence).controller;
  t.after(() => reopened.pause());
  assert.equal(await reopened.restoreSelection(), true);
  assert.deepEqual(reopened.selected, b);
  reopened.original();
  assert.equal(reopened.selected, undefined);
  const original = controllerFor(f, saved.persistence).controller;
  t.after(() => original.pause());
  assert.equal(await original.restoreSelection(), false);
  assert.equal(original.profile, undefined);
});

test("selection restoration rejects malformed, missing, unconfirmed and cross-profile scopes", async (t) => {
  const f = await experienceFixture(t);
  const ready = await f.confirm("sessions");
  const another = await f.confirm("sessions");
  const proposed = await f.propose("sessions");
  for (const initial of [
    undefined,
    null,
    "broken JSON",
    {},
    {
      version: 2,
      selected: { profileId: ready.profile.id, scopeId: ready.scopes[0].id },
    },
    {
      version: 1,
      selected: { profileId: "not-a-uuid", scopeId: ready.scopes[0].id },
    },
    {
      version: 1,
      selected: { profileId: ready.profile.id, scopeId: "not-a-uuid" },
    },
    {
      version: 1,
      selected: { profileId: crypto.randomUUID(), scopeId: ready.scopes[0].id },
    },
    {
      version: 1,
      selected: { profileId: ready.profile.id, scopeId: crypto.randomUUID() },
    },
    {
      version: 1,
      selected: { profileId: ready.profile.id, scopeId: another.scopes[0].id },
    },
    {
      version: 1,
      selected: { profileId: proposed.id, scopeId: ready.scopes[0].id },
    },
    {
      version: 1,
      selected: { profileId: ready.profile.id, scopeId: ready.scopes[0].id },
      transcript: "must not load",
    },
  ]) {
    const saved = preference(initial);
    const { controller, streams } = controllerFor(f, saved.persistence);
    assert.equal(
      await controller.restoreSelection(),
      false,
      JSON.stringify(initial),
    );
    assert.equal(controller.selected, undefined);
    assert.equal(controller.profile, undefined);
    assert.equal(streams.length, 0);
    controller.pause();
  }
  const denied = controllerFor(f, {
    load: () => {
      throw Error("Denied");
    },
    save: () => {
      throw Error("Denied");
    },
  }).controller;
  t.after(() => denied.pause());
  assert.equal(await denied.restoreSelection(), false);
  await denied.selectProfile(ready.profile.id);
  assert.equal(denied.selected?.scopeId, ready.scopes[0].id);
  denied.original();
  assert.equal(denied.profile, undefined);
});

test("Original chat and newer profile navigation fence a late saved-selection response", async (t) => {
  const f = await experienceFixture(t);
  const first = await f.confirm("sessions");
  const other = await f.confirm("sessions");
  for (const destination of ["original", "profile"]) {
    const saved = preference({
      version: 1,
      selected: { profileId: first.profile.id, scopeId: first.scopes[1].id },
    });
    const { controller, client } = controllerFor(f, saved.persistence);
    const held = deferred();
    const state = client.state;
    client.state = async (id, signal) => {
      if (id === first.profile.id) {
        await held.promise;
        return f.state(id);
      }
      return state(id, signal);
    };
    const pending = controller.restoreSelection();
    if (destination === "original") controller.original();
    else await controller.selectProfile(other.profile.id);
    held.resolve();
    assert.equal(await pending, false);
    assert.equal(
      controller.selected?.profileId,
      destination === "original" ? undefined : other.profile.id,
    );
    controller.pause();
  }
});

test("a model response arriving after pause and resume cannot overwrite current session state", async (t) => {
  const f = await experienceFixture(t);
  const profile = await f.confirm("sessions");
  const scope = {
    profileId: profile.profile.id,
    scopeId: profile.scopes[0].id,
  };
  const { controller, client } = controllerFor(f, preference().persistence);
  t.after(() => controller.pause());
  await controller.selectProfile(scope.profileId);
  const old = await f.scope(scope.profileId, scope.scopeId);
  controller.receive(scope, old);
  let release!: (value: ExperienceScopeState) => void;
  const held = new Promise<ExperienceScopeState>((resolve) => {
    release = resolve;
  });
  const began = deferred();
  client.model = async () => {
    began.resolve();
    return held;
  };
  controller.selectModel(scope, { modelId: "second", thinkingLevel: "low" });
  await began.promise;
  controller.pause();
  controller.resume();
  release({
    ...old,
    revision: old.revision + 100,
    chat: { ...old.chat, modelId: "second" },
  });
  await tick();
  assert.equal(controller.entry(scope).state?.chat.modelId, "gpt-6.1-sol");
});

test("server main restores its saved session and null main opens Earlier chat", async (t) => {
  const f = await experienceFixture(t);
  const setup = await f.confirm("sessions");
  const saved = preference({
    version: 1,
    selected: { profileId: setup.profile.id, scopeId: setup.scopes[1].id },
  });
  const { controller, client } = controllerFor(f, saved.persistence);
  t.after(() => controller.pause());
  client.main = async () => ({
    version: 1,
    profileId: setup.profile.id,
    setAt: new Date().toISOString(),
  });
  assert.equal(await controller.restoreSelection(), true);
  assert.equal(controller.selected?.scopeId, setup.scopes[1].id);
  controller.original();
  client.main = async () => ({
    version: 1,
    profileId: null,
    setAt: new Date().toISOString(),
  });
  assert.equal(await controller.restoreSelection(), false);
  assert.equal(controller.selected, undefined);
});

test("delayed main reads respect newer navigation and draft changes", async (t) => {
  const f = await experienceFixture(t);
  const setup = await f.confirm();
  for (const action of ["navigation", "draft"]) {
    const { controller, client } = controllerFor(f, preference().persistence);
    const gate = deferred();
    client.main = async () => {
      await gate.promise;
      return {
        version: 1,
        profileId: setup.profile.id,
        setAt: new Date().toISOString(),
      };
    };
    let untouched = true;
    const pending = controller.restoreSelection(() => untouched);
    if (action === "navigation") controller.original();
    else untouched = false;
    gate.resolve();
    assert.equal(await pending, false);
    assert.equal(controller.selected, undefined);
    controller.pause();
  }
});

test("inline use keeps successful confirmation recoverable after a main write failure", async (t) => {
  const f = await experienceFixture(t);
  const proposal = await f.propose();
  const { controller, client } = controllerFor(f, preference().persistence);
  t.after(() => controller.pause());
  await controller.refresh();
  let confirms = 0;
  const confirm = client.confirm;
  client.confirm = (...args) => {
    confirms++;
    return confirm(...args);
  };
  const selectMain = client.selectMain;
  client.selectMain = async () => {
    throw new Error("fixture disconnected");
  };
  assert.equal(await controller.useSetup(proposal), false);
  assert.equal((await f.state(proposal.id)).scopes.length, 1);
  assert.equal(controller.selected, undefined);
  assert.match(controller.proposalErrors.get(proposal.id)!, /Setup created/);
  assert(
    controller.createdSetups.has(proposal.id),
    "unanchored created card remains visible for retry",
  );
  client.selectMain = selectMain;
  assert.equal(await controller.useSetup(controller.profiles[0]), true);
  assert.equal(confirms, 1);
  assert.deepEqual(controller.selected, {
    profileId: proposal.id,
    scopeId: (await f.state(proposal.id)).scopes[0].id,
  });
  assert.equal((await f.state(proposal.id)).scopes.length, 1);
});

test("delayed inline confirmation never overrides newer navigation or a draft", async (t) => {
  const f = await experienceFixture(t);
  for (const action of ["navigation", "draft"]) {
    const proposal = await f.propose();
    const { controller, client } = controllerFor(f, preference().persistence);
    await controller.refresh();
    const gate = deferred();
    const confirm = client.confirm;
    client.confirm = async (...args) => {
      await gate.promise;
      return confirm(args[0], args[1]);
    };
    let mainWrites = 0;
    client.selectMain = async (id) => {
      mainWrites++;
      return { version: 1, profileId: id, setAt: new Date().toISOString() };
    };
    let untouched = true;
    const pending = controller.useSetup(proposal, () => untouched);
    if (action === "navigation") controller.original();
    else untouched = false;
    gate.resolve();
    assert.equal(await pending, false);
    assert.equal(mainWrites, 0);
    assert.equal(controller.selected, undefined);
    assert.equal(
      controller.profiles.find((p) => p.id === proposal.id)?.kind,
      "ready",
    );
    controller.pause();
  }
});
