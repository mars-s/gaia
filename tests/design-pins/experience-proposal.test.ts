
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { experienceFixture } from "../../apps/server/testing/experiences.ts";


import { ExperienceProposalNotice } from "../../apps/web/experiences/proposal";
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
test("proposal change caption sits after the actions and memory copy reflects the real layout", async (t) => {
  const f = await experienceFixture(t);
  try {
    const proposal = await f.propose();
    const html = renderToStaticMarkup(createElement(ExperienceProposalNotice, {
      proposals: [proposal], disabled: false,
    }));
    assert.ok(html.indexOf("Or tell me what to change.") > html.indexOf("Use this setup"));
    assert.match(html, /your original chat stays available/);
    assert.match(html, /setup-memory-caption/);
    assert.match(html, /class="status-pill" data-tone="neutral">Proposed/);
    assert.equal((html.match(/original chat/g) ?? []).length, 1);
    assert.equal((html.match(/main chat/g) ?? []).length, 1);
    assert.match(html, /proposal-heading/);
    assert.doesNotMatch(html, /text-body-regular text-text-secondary|whitespace-pre-wrap/);
  } finally {
    await f.close();
  }
});
test("every proposal explains the actual memory boundary and preserves the original chat", async t => {
 const f = await experienceFixture(t);
 const explanations = {
  single: "One conversation keeps your shared memory",
  bots: "Each Bot keeps its own memory and conversation",
  channels: "Channels share remembered facts and keep separate conversations",
  sessions: "Sessions keep separate histories and share new remembered facts",
 } as const;
 for (const layout of ["single", "bots", "channels", "sessions"] as const) {
  const proposal = await f.propose(layout);
  const html = renderToStaticMarkup(createElement(ExperienceProposalNotice, { proposals: [proposal], disabled: false }));
  assert.ok(html.includes(`This becomes your main chat. ${explanations[layout]}, and your original chat stays available.`));
  assert.match(html, /class="status-pill" data-tone="neutral">Proposed/);
  assert.ok(html.indexOf("Or tell me what to change.") > html.indexOf("Use this setup"));
 }
});
