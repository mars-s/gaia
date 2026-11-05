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
    "Earlier chat stays available",
  ])
    assert(html.includes(text), text);
  assert(!html.includes(proposal.id));
  assert(!html.includes("revision"));
  assert.match(
    render(proposal, "This setup changed. Look again."),
    /This setup changed. Look again./,
  );
  assert.match(
    render({
      ...proposal,
      proposal: { ...proposal.proposal!, supersededBy: proposal.id },
    }),
    /Replaced by a newer setup/,
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
