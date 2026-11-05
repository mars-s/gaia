import { z } from "zod";
import {
  ExperiencePlan,
  ScopePlan,
} from "../../packages/protocol/experiences.ts";

export const setupPurposeGuidance =
  "Purpose text is shown directly to the owner. Describe the help the assistant provides in plain language. Keep avatar sources, asset names, internal identifiers and implementation notes out of purpose text. Gaia assigns Bot avatars automatically.";
const purpose = ExperiencePlan.shape.purpose.describe(setupPurposeGuidance);
export const SetupProposalPlan = ExperiencePlan.safeExtend({
  purpose,
  scopes: z
    .array(ScopePlan.omit({ avatar: true }).extend({ purpose }))
    .min(1)
    .max(20),
});
