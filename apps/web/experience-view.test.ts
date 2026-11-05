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
import { ExperienceConversation } from "./experiences/view";
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
test("four layouts share one chat with distinct navigation and memory semantics", () => {
  for (const layout of ["single", "bots", "channels", "sessions"] as const) {
    const { controller, html } = fixture(layout);
    const markup = html();
    assert.match(markup, /Message assistant/);
    if (layout === "single")
      assert.doesNotMatch(markup, /<nav|New Bot|New session|New channel/);
    if (layout === "bots") {
      assert.match(markup, /New Bot/);
      assert.match(markup, /\/bots\/bot-01.svg/);
    }
    if (layout === "channels") {
      assert.match(markup, /Shared memory, separate threads/);
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
  for (const layout of ["channels", "sessions"] as const) {
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
    assert.match(markup, /src="\/bots\/bot-02.svg"/);
    assert.doesNotMatch(markup, /src="\/bots\/bot-01.svg"/);
    controller.pause();
  }
});
