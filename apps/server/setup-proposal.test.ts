import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { SetupProposalPlan, setupPurposeGuidance } from "./setup-proposal.ts";
import { ExperiencePlan } from "../../packages/protocol/experiences.ts";

test("model setup proposals request owner-facing purposes and leave avatars to code", () => {
  const schema = z.toJSONSchema(SetupProposalPlan);
  const scope = SetupProposalPlan.shape.scopes.element.shape;
  assert.deepEqual(Object.keys(scope), ["label", "purpose"]);
  assert.doesNotMatch(JSON.stringify(schema), /"avatar"|bot-\d{2}/);
  assert.equal(
    SetupProposalPlan.shape.purpose.description,
    setupPurposeGuidance,
  );
  assert.equal(scope.purpose.description, setupPurposeGuidance);
  assert.match(
    setupPurposeGuidance,
    /Keep avatar sources, asset names, internal identifiers and implementation notes out of purpose text/,
  );
  const plan = {
    layout: "bots",
    title: "Work",
    assistantName: "Gaia",
    purpose: "Help with work",
    scopes: [{ label: "Work", purpose: "Plan the working day" }],
  };
  assert(SetupProposalPlan.safeParse(plan).success);
  const explicit = {
    ...plan,
    scopes: [{ ...plan.scopes[0], avatar: "bot-01" }],
  };
  assert.equal(SetupProposalPlan.safeParse(explicit).success, false);
  assert(
    ExperiencePlan.safeParse(explicit).success,
    "Existing API plans retain their avatars",
  );
});
