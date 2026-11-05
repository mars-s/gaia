import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { experienceFixture } from "../server/testing/experiences.ts";
import { createExperienceClient } from "../../packages/sdk/experiences.ts";
import { createExperienceController } from "./experiences/controller";
import { ExperienceProposalNotice } from "./experiences/proposal";

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
  assert.match(notice(), /Review setup/);
  assert(!notice().includes(proposal.id));
  assert.equal((await f.state(proposal.id)).scopes.length, 0);
  assert.equal(
    await controller.confirm({ ...proposal, revision: proposal.revision + 1 }),
    false,
  );
  assert.match(notice(), /Review setup/);
  assert.equal(await controller.confirm(proposal), true);
  assert.equal((await f.state(proposal.id)).profile.kind, "ready");
  assert.equal(notice(), "");
});
