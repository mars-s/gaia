import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { experienceFixture } from "../server/testing/experiences.ts";
import { createExperienceClient } from "../../packages/sdk/experiences.ts";
import { createExperienceController } from "./experiences/controller";
import {
  ExperienceProposalNotice,
  proposalsAfterAnswer,
} from "./experiences/proposal";

test("real setup stays pending until exact confirmation, then its review notice disappears", async (t) => {
  const f = await experienceFixture(t);
  const proposal = await f.propose();
  const client = createExperienceClient({
    fetch: (url, init) => fetch(new URL(String(url), f.base), init),
    events: () => ({
      onmessage: null,
      onerror: null,
      onopen: null,
      close() {},
    }),
  });
  const controller = createExperienceController({
    client,
    selectionPersistence: { load: () => undefined, save() {} },
  });
  t.after(() => controller.pause());
  await controller.refresh();
  await controller.selectProfile(proposal.id);
  const notice = () =>
    renderToStaticMarkup(
      createElement(ExperienceProposalNotice, {
        proposals: controller.profiles,
        disabled: false,
        onReview() {},
      }),
    );
  assert.match(notice(), /Use this setup/);
  assert(!notice().includes(proposal.id));
  assert.equal((await f.state(proposal.id)).scopes.length, 0);
  assert.equal(
    await controller.confirm({ ...proposal, revision: proposal.revision + 1 }),
    false,
  );
  assert.match(notice(), /Use this setup/);
  assert.equal(await controller.confirm(proposal), true);
  assert.equal((await f.state(proposal.id)).profile.kind, "ready");
  assert.match(notice(), /Setup created/);
  assert.match(notice(), /Open it/);
});

test("inline card shows the full exact plan and friendly states without internal identifiers", async (t) => {
  const f = await experienceFixture(t);
  const proposal = await f.propose("bots");
  const render = (value = proposal, error?: string) =>
    renderToStaticMarkup(
      createElement(ExperienceProposalNotice, {
        proposals: [value],
        disabled: false,
        errors: new Map(error ? [[value.id, error]] : []),
      }),
    );
  const html = render();
  for (const text of [
    proposal.plan.title,
    proposal.plan.assistantName,
    proposal.plan.purpose,
    ...proposal.plan.scopes.flatMap((s) => [s.label, s.purpose]),
    "Use this setup",
    "Not now",
    "Or tell me what to change.",
    "The earlier chat stays available",
  ])
    assert(html.includes(text), text);
  assert(!html.includes(proposal.id));
  assert(!html.includes("revision"));
  assert.match(
    render(proposal, "This setup changed since you looked. Read it again."),
    /This setup changed since you looked. Read it again./,
  );
  assert.match(
    render({
      ...proposal,
      proposal: { ...proposal.proposal!, supersededBy: proposal.id },
    }),
    /Replaced by a newer proposal/,
  );
  assert.equal(
    render({
      ...proposal,
      proposal: {
        ...proposal.proposal!,
        dismissedAt: new Date().toISOString(),
      },
    }),
    "",
  );
});

test("cards bind to their actual answer and unanchored partial operations remain visible", async (t) => {
  const f = await experienceFixture(t);
  const proposal = await f.propose();
  const bound = {
    ...proposal,
    proposal: {
      ...proposal.proposal!,
      source: { kind: "conversation" as const, conversationId: "trusted-home" },
      answerMessageId: "answer-a",
    },
  };
  assert.deepEqual(proposalsAfterAnswer([bound], "answer-a"), [bound]);
  assert.deepEqual(proposalsAfterAnswer([bound], "answer-b"), []);
  assert.deepEqual(proposalsAfterAnswer([bound]), []);
  assert.deepEqual(proposalsAfterAnswer([proposal]), [proposal]);
  const ready = { ...proposal, kind: "ready" as const };
  assert.deepEqual(proposalsAfterAnswer([ready]), []);
  assert.deepEqual(
    proposalsAfterAnswer([ready], undefined, new Set([ready.id])),
    [ready],
  );
});

test("proposal actions put primary acceptance first, quiet dismissal second and disable both while setting up", async (t) => {
  const f = await experienceFixture(t);
  const proposal = await f.propose("bots");
  const render = (pending = false) =>
    renderToStaticMarkup(
      createElement(ExperienceProposalNotice, {
        proposals: [proposal],
        disabled: false,
        pending: new Set(pending ? [proposal.id] : []),
      }),
    );
  const buttons = [
    ...render().matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g),
  ].map((m) => m[0]);
  assert.equal(buttons.length, 2);
  assert.match(buttons[0], /bg-button-primary/);
  assert.match(buttons[0], /Use this setup/);
  assert.match(buttons[1], /quiet-action/);
  assert.match(buttons[1], /Not now/);
  assert.equal((render(true).match(/disabled=""/g) ?? []).length, 2);
  assert.match(render(true), /Setting up…/);
  assert.equal(
    (render().match(/class="avatar-tile"/g) ?? []).length,
    proposal.plan.scopes.length,
  );
  assert.match(render(), /<h2 class="text-title-3-semibold"/);
});

test("created card collapses and stale error sits above the actions", async (t) => {
  const f = await experienceFixture(t);
  const proposal = await f.propose();
  const created = renderToStaticMarkup(
    createElement(ExperienceProposalNotice, {
      proposals: [{ ...proposal, kind: "ready" }],
      disabled: false,
    }),
  );
  assert.match(created, /Setup created\./);
  assert.match(created, /Open it/);
  assert.doesNotMatch(created, /Use this setup|Not now|<h2|<ul/);
  const stale = "This setup changed since you looked. Read it again.";
  const html = renderToStaticMarkup(
    createElement(ExperienceProposalNotice, {
      proposals: [proposal],
      disabled: false,
      errors: new Map([[proposal.id, stale]]),
    }),
  );
  assert(html.indexOf(stale) < html.indexOf("Use this setup"));
  assert.match(html, /role="alert" class="text-text-error-primary"/);
});
