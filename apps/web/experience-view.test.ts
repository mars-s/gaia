import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ExperienceState,
  ExperienceScopeState,
  ScopeId,
  type ExperienceLayout,
} from "../../packages/protocol/experiences.ts";
import {
  ExperienceConversation,
  RetryConfirmation,
  createActivityAnnouncer,
} from "./experiences/view";
import { createExperienceController } from "./experiences/controller";
const pid = "11111111-1111-4111-8111-111111111111";
const sid = "22222222-2222-4222-8222-222222222222";
function fixture(layout: ExperienceLayout) {
  const scope = {
    id: sid,
    profileId: pid,
    label: "Main",
    purpose: "Test",
    avatar: "bot-01",
    createdAt: "now",
  };
  const controller = createExperienceController({
    persistence: () => ({ load: async () => undefined, save: async () => {} }),
  });
  controller.profile = ExperienceState.parse({
    version: 1,
    profile: {
      id: pid,
      revision: 1,
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
    scopes: [scope],
    jobs: [],
    capabilities: {
      machine: false,
      desktop: false,
      search: false,
      selfModification: false,
    },
  });
  const parsed = ExperienceScopeState.parse({
    version: 1,
    profileId: pid,
    scope,
    revision: 1,
    messages: [
      { id: "input", role: "user", text: "Check two things", createdAt: "now" },
      {
        id: "ack",
        role: "assistant",
        text: "I will check both.",
        createdAt: "now",
      },
    ],
    jobs: [],
    chat: { models: [], modelId: "model", compaction: { kind: "idle" } },
    memoryRevision: 0,
  });
  controller.selected = {
    profileId: parsed.profileId,
    scopeId: parsed.scope.id,
  };
  controller.receive(controller.selected, parsed);
  return {
    controller,
    parsed,
    html: () =>
      renderToStaticMarkup(
        createElement(ExperienceConversation, { controller }),
      ),
  };
}
test("a removed model explains a blocked image draft and keeps its content", async () => {
  const { controller, html } = fixture("single");
  const selected = controller.selected;
  assert(selected);
  const entry = controller.entry(selected);
  await entry.draft.load();
  const image = {
    id: crypto.randomUUID(),
    name: "Keep image",
    mimeType: "image/png" as const,
    data: "YWJj",
  };
  entry.draft.update(() => ({ text: "Keep this message", images: [image] }));
  assert.match(html(), /Choose an available model to send/);
  const draft = entry.draft.read();
  assert.equal(draft.kind, "ready");
  if (draft.kind === "ready") {
    assert.equal(draft.draft.text, "Keep this message");
    assert.deepEqual(draft.draft.images, [image]);
  }
  controller.pause();
});
test("four layouts share one chat with distinct navigation and memory semantics", () => {
  for (const layout of ["single", "bots", "channels", "sessions"] as const) {
    const { controller, html } = fixture(layout);
    const markup = html();
    assert.match(markup, /Message assistant/);
    if (layout === "single")
      assert.doesNotMatch(markup, /<nav|New Bot|New session|New channel/);
    if (layout === "bots") {
      assert.match(markup, /New Bot/);
      assert.match(markup, /sidebar-avatar/);
      assert.match(markup, /avatar-tile/);
      assert.doesNotMatch(markup, /border-border-secondary|>Setups</);
      assert.match(markup, /\/bots\/bot-01.svg/);
    }
    if (layout === "channels") {
      assert.doesNotMatch(markup, /Shared memory, separate threads/);
      assert.match(markup, /scope-header/);
      assert.match(markup, /New channel/);
      assert.doesNotMatch(markup, /New Bot/);
    }
    if (layout === "sessions") {
      assert.match(markup, /New session/);
      assert.doesNotMatch(markup, /Shared memory/);
    }
    controller.pause();
  }
});
test("only the selected sidebar row carries the current state in every list layout", () => {
  for (const layout of ["bots", "channels", "sessions"] as const) {
    const { controller, parsed, html } = fixture(layout);
    assert(controller.profile);
    const other = {
      ...parsed.scope,
      id: ScopeId.parse("33333333-3333-4333-8333-333333333333"),
      label: "Other",
    };
    controller.profile.scopes.push(other);
    for (const selected of [parsed.scope, other]) {
      controller.selected = {
        profileId: parsed.profileId,
        scopeId: selected.id,
      };
      controller.receive(controller.selected, { ...parsed, scope: selected });
      const navigation = html().match(/<nav\b[^>]*>(.*?)<\/nav>/s)?.[1];
      assert(navigation);
      const rows = [
        ...navigation.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs),
      ].filter((row) => row[1].includes("experience-nav-row"));
      assert.equal(rows.length, 2);
      const current = rows.filter((row) =>
        row[1].includes('aria-current="page"'),
      );
      assert.equal(current.length, 1);
      assert.match(current[0][2], new RegExp(`>${selected.label}<`));
      assert.equal((navigation.match(/aria-current=/g) ?? []).length, 1);
      assert.doesNotMatch(navigation, /bg-background-secondary-default/);
      assert.match(
        navigation,
        /class="quiet-action [^"]*"[^>]*>New (?:Bot|channel|session)<\/button>/,
      );
    }
    controller.pause();
  }
});

test("independent real activity descriptions disappear on completion", () => {
  const { controller, parsed, html } = fixture("single");
  const base = {
    profileId: pid,
    scopeId: sid,
    requestId: crypto.randomUUID(),
    messageId: "input",
    answerId: "ack",
    title: "Check fixture",
    contextRevision: 0,
  };
  parsed.jobs = ExperienceScopeState.shape.jobs.parse(
    [0, 1].map((index) => ({
      ...base,
      id: crypto.randomUUID(),
      state: {
        kind: "running",
        startedAt: "now",
        activity: [
          {
            id: `activity-${index}`,
            callId: `call-${index}`,
            description: `Checking fixture ${index}`,
            kind: "file",
          },
        ],
      },
    })),
  );
  parsed.revision++;
  if (controller.selected)
    controller.receive(controller.selected, { ...parsed });
  let markup = html();
  assert.match(markup, /Checking fixture 0/);
  assert.match(markup, /Checking fixture 1/);
  assert.match(markup, /Stop Check fixture/);
  parsed.jobs = parsed.jobs.map((job) => ({
    ...job,
    state: {
      kind: "completed",
      finishedAt: "now",
      text: "Done",
      citations: [],
    },
  }));
  parsed.revision++;
  if (controller.selected)
    controller.receive(controller.selected, { ...parsed });
  markup = html();
  assert.doesNotMatch(
    markup,
    /Checking fixture|Stop Check fixture|Trying again could repeat/,
  );
  controller.pause();
});

test("one assistant keeps the same activity avatar across channels and sessions", () => {
  for (const layout of ["single", "channels", "sessions"] as const) {
    const { controller, parsed, html } = fixture(layout);
    assert(controller.profile);
    controller.profile.scopes.unshift({
      ...parsed.scope,
      id: ScopeId.parse("33333333-3333-4333-8333-333333333333"),
      avatar: "bot-02",
    });
    parsed.jobs = ExperienceScopeState.shape.jobs.parse([
      {
        id: crypto.randomUUID(),
        profileId: pid,
        scopeId: sid,
        requestId: crypto.randomUUID(),
        messageId: "input",
        answerId: "ack",
        title: "Shared assistant activity",
        contextRevision: 0,
        state: {
          kind: "running",
          startedAt: "now",
          activity: [
            {
              id: "activity",
              callId: "call",
              description: "Checking this conversation",
              kind: "other",
            },
          ],
        },
      },
    ]);
    parsed.revision++;
    assert(controller.selected);
    controller.receive(controller.selected, { ...parsed });
    const markup = html();
    assert.match(markup, /class="gaia-mark"/);
    assert.doesNotMatch(markup, /src="\/bots\/bot-02.svg"/);
    assert.doesNotMatch(markup, /src="\/bots\/bot-01.svg"/);
    controller.pause();
  }
});

function progressJob(
  kind: "queued" | "running" = "running",
  descriptions: string[] = [],
) {
  return ExperienceScopeState.shape.jobs.element.parse({
    id: crypto.randomUUID(),
    profileId: pid,
    scopeId: sid,
    requestId: crypto.randomUUID(),
    messageId: "input",
    answerId: "ack",
    title: "PRIVATE OWNER PROMPT",
    contextRevision: 0,
    state:
      kind === "queued"
        ? { kind, acceptedAt: "now" }
        : {
            kind,
            startedAt: "now",
            activity: descriptions.map((description, index) => ({
              id: `activity-${index}`,
              callId: `call-${index}`,
              kind: "other",
              description,
            })),
          },
  });
}

test("queued and running progress has only an avatar and exact-job Stop, without title leakage", () => {
  for (const layout of ["single", "bots", "channels", "sessions"] as const) {
    for (const kind of ["queued", "running"] as const) {
      const { controller, parsed, html } = fixture(layout);
      parsed.jobs = [progressJob(kind)];
      parsed.revision++;
      assert(controller.selected);
      controller.receive(controller.selected, { ...parsed });
      const markup = html();
      const visible = markup.replace(/<[^>]*>/g, "");
      assert.doesNotMatch(
        visible,
        /PRIVATE OWNER PROMPT|Queued|Running|Thinking/,
      );
      assert.match(markup, /aria-label="Stop PRIVATE OWNER PROMPT"/);
      assert.match(markup, /job-avatar-pulse/);
      assert.equal((markup.match(/aria-live="polite"/g) ?? []).length, 1);
      assert.equal((markup.match(/role="status"/g) ?? []).length, 1);
      assert.match(
        markup,
        layout === "bots" ? /src="\/bots\/bot-01.svg"/ : /class="gaia-mark"/,
      );
      assert.match(markup, /composer-send[^"]*composer-stop/);
      assert.match(markup, /aria-label="Stop reply"/);
      controller.pause();
    }
  }
});

test("concurrent activity rows keep complete descriptions without duplicate live regions", () => {
  const { controller, parsed, html } = fixture("single");
  const description =
    "Checking the actual target with a long model-supplied description that must remain available";
  parsed.jobs = [
    progressJob("running", [description, "Inspecting fixture"]),
    progressJob("running", ["Reading fixture"]),
  ];
  parsed.revision++;
  assert(controller.selected);
  controller.receive(controller.selected, { ...parsed });
  const markup = html();
  assert.match(markup, new RegExp(`title="${description}"`));
  assert.match(markup, /min-w-0 truncate/);
  assert.equal((markup.match(/aria-live="polite"/g) ?? []).length, 1);
  assert.equal((markup.match(/role="status"/g) ?? []).length, 1);
  assert.doesNotMatch(
    markup.replace(/<[^>]*>/g, ""),
    /PRIVATE OWNER PROMPT|Running|Thinking/,
  );
  assert.doesNotMatch(markup, /job-avatar-pulse/);
  parsed.jobs = parsed.jobs.map((job) => ({
    ...job,
    state: {
      kind: "completed",
      text: "Done",
      finishedAt: "now",
      citations: [],
    },
  }));
  parsed.messages[1].text = "The actual streamed answer stays.";
  parsed.revision++;
  controller.receive(controller.selected, { ...parsed });
  const settled = html();
  assert.doesNotMatch(settled, /job-progress|gaia-mark|Stop PRIVATE/);
  assert.match(settled, /The actual streamed answer stays/);
  controller.pause();
});

test("conversation announcements debounce real changes, ignore repeats and cancel on settlement", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const spoken: string[] = [];
  const announcer = createActivityAnnouncer((text) => spoken.push(text));
  const first = progressJob();
  announcer.update([first]);
  t.mock.timers.tick(2000);
  assert.deepEqual(spoken, []);
  const active = progressJob("running", ["Checking fixture"]);
  announcer.update([active]);
  t.mock.timers.tick(600);
  announcer.update([active]);
  t.mock.timers.tick(399);
  assert.deepEqual(spoken, []);
  t.mock.timers.tick(1);
  assert.deepEqual(spoken, ["Checking fixture"]);
  announcer.update([active]);
  t.mock.timers.tick(2000);
  assert.deepEqual(spoken, ["Checking fixture"]);
  const newer = progressJob("running", ["Reading fixture"]);
  announcer.update([active, newer]);
  t.mock.timers.tick(500);
  const newest = progressJob("running", ["Verifying fixture"]);
  announcer.update([active, newer, newest]);
  t.mock.timers.tick(999);
  assert.deepEqual(spoken, ["Checking fixture"]);
  t.mock.timers.tick(1);
  assert.deepEqual(spoken, ["Checking fixture", "Verifying fixture"]);
  announcer.update([progressJob("running", ["Unfinished activity"])]);
  announcer.update([]);
  t.mock.timers.tick(2000);
  assert.deepEqual(spoken, ["Checking fixture", "Verifying fixture", ""]);
  announcer.dispose();
});

test("disposing a conversation cancels pending speech and a new scope starts independently", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const oldSpeech: string[] = [];
  const oldScope = createActivityAnnouncer((text) => oldSpeech.push(text));
  oldScope.update([progressJob("running", ["Old scope"])]);
  t.mock.timers.tick(999);
  oldScope.dispose();
  const newSpeech: string[] = [];
  const newScope = createActivityAnnouncer((text) => newSpeech.push(text));
  newScope.update([progressJob("running", ["New scope"])]);
  t.mock.timers.tick(1000);
  assert.deepEqual(oldSpeech, []);
  assert.deepEqual(newSpeech, ["New scope"]);
  newScope.dispose();
});

test("failed, stopped, interrupted and uncertain jobs retain recovery controls", () => {
  for (const state of [
    {
      kind: "failed",
      partialText: "",
      finishedAt: "now",
      message: "Fixture failed",
    },
    { kind: "stopped", partialText: "", finishedAt: "now" },
    { kind: "interrupted", partialText: "", interruptedAt: "now" },
    {
      kind: "uncertain",
      partialText: "",
      interruptedAt: "now",
      invocationIds: ["call"],
      message: "Fixture may have happened",
    },
  ]) {
    const { controller, parsed, html } = fixture("single");
    const job = progressJob();
    parsed.jobs = ExperienceScopeState.shape.jobs.parse([{ ...job, state }]);
    parsed.revision++;
    assert(controller.selected);
    controller.receive(controller.selected, { ...parsed });
    const markup = html();
    assert.match(markup, /Try again/);
    assert.doesNotMatch(markup, /job-avatar-pulse|aria-label="Stop PRIVATE/);
    assert.match(markup, /PRIVATE OWNER PROMPT/);
    if (state.message) assert.match(markup, new RegExp(state.message));
    controller.pause();
  }
});

test("unchanged wording from a different activity is not announced twice", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const spoken: string[] = [];
  const announcer = createActivityAnnouncer((text) => spoken.push(text));
  announcer.update([progressJob("running", ["Checking fixture"])]);
  t.mock.timers.tick(1000);
  announcer.update([progressJob("running", ["Checking fixture"])]);
  t.mock.timers.tick(2000);
  assert.deepEqual(spoken, ["Checking fixture"]);
  announcer.dispose();
});

test("pending Stop keeps its exact-job accessible name without exposing progress titles", () => {
  const { controller, parsed, html } = fixture("single");
  parsed.jobs = ExperienceScopeState.shape.jobs.parse([
    {
      ...progressJob(),
      state: { kind: "stopping", requestedAt: "now", activity: [] },
    },
  ]);
  parsed.revision++;
  assert(controller.selected);
  controller.receive(controller.selected, { ...parsed });
  const markup = html();
  assert.match(markup, /disabled="" aria-label="Stop PRIVATE OWNER PROMPT"/);
  assert.doesNotMatch(
    markup.replace(/<[^>]*>/g, ""),
    /PRIVATE OWNER PROMPT|Stopping/,
  );
  controller.pause();
});

test("retry card renders exact copy and Cancel never confirms", () => {
  let confirmed = 0,
    cancelled = 0;
  const card = RetryConfirmation({
    uncertain: false,
    disabled: false,
    onConfirm: () => {
      confirmed++;
    },
    onCancel: () => {
      cancelled++;
    },
  });
  const markup = renderToStaticMarkup(card);
  assert.match(
    markup,
    /Gaia already started an action in this attempt\. Trying again runs the whole request again, so that action may happen twice\./,
  );
  assert.match(markup, />Run it again</);
  assert.match(markup, />Cancel</);
  const children = card.props.children;
  children[2].props.onClick();
  assert.equal(cancelled, 1);
  assert.equal(confirmed, 0);
  children[1].props.onClick();
  assert.equal(confirmed, 1);
  const uncertain = renderToStaticMarkup(
    RetryConfirmation({
      uncertain: true,
      disabled: false,
      onConfirm: () => {},
      onCancel: () => {},
    }),
  );
  assert.match(
    uncertain,
    /This action may already have happened\. Trying again could repeat it\./,
  );
  assert.match(uncertain, />Repeat action</);
});

test("sidebar working dots reserve their slot and follow actual active jobs", () => {
  const { controller, html } = fixture("bots");
  assert(controller.profile);
  assert.match(html(), /scope-work-dot[^>]+data-working="false"/);
  controller.profile.jobs = [progressJob()];
  assert.match(html(), /scope-work-dot[^>]+data-working="true"/);
  controller.profile.jobs = [];
  assert.match(html(), /scope-work-dot[^>]+data-working="false"/);
  controller.pause();
});
