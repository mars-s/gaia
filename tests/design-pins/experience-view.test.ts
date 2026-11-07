import { readFileSync } from "node:fs";
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
import { ExperienceConversation } from "../../apps/web/experiences/view";
import { createExperienceController } from "../../apps/web/experiences/controller";
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
test("all sidebar shapes keep names without purposes or previews for populated and empty histories", () => {
 for (const layout of ["sessions", "channels", "bots"] as const) {
   const {controller, parsed, html} = fixture(layout);
   const nav = () => html().match(/<nav[^]*?<\/nav>/)?.[0] ?? "";
   for (const messages of [parsed.messages, [], [{id: "long", role: "assistant" as const, text: "A long message that must stay out of navigation", createdAt: "now"}]]) {
     controller.receive(controller.selected!, {...parsed, revision: controller.entry(controller.selected!).state!.revision + 1, messages});
     assert.match(nav(), /scope-row-copy[^]*>Main</);
     assert.doesNotMatch(nav(), /scope-preview|session-recency|data-two-lines|I will check both|A long message/);
   }
   controller.pause();
 }
 const css = readFileSync(new URL("../../apps/web/style.css", import.meta.url), "utf8");
 assert.match(css, /experience-nav-row.secondary-action \{ padding: 8px 10px; height: 36px/);
 assert.doesNotMatch(css, /experience-nav-row\[data-two-lines/);
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
        /class="quiet-action [^"]*"[^>]*><span class="new-icon">[\s\S]*?<\/svg><\/span><span>New (?:Bot|channel|session)<\/span><\/button>/,
      );
    }
    controller.pause();
  }
});
test("every setup uses the shared composer contract and only settled answers offer copy", () => {
  for (const layout of ["single", "bots", "channels", "sessions"] as const) {
    const { controller, parsed, html } = fixture(layout);
    assert.match(html(), /class="composer flex flex-col gap-2 p-2"/);
    assert.equal((html().match(/aria-label="Copy answer"/g) ?? []).length, 1);
    parsed.jobs = [progressJob()];
    parsed.revision++;
    assert(controller.selected);
    controller.receive(controller.selected, { ...parsed });
    assert.doesNotMatch(html(), /aria-label="Copy answer"/);
    controller.pause();
  }
});
