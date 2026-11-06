import { z } from "zod";
import { Chat, Message, ModelSelection } from "./index.ts";
import { Attachment, AttachmentId, imageLimits } from "./attachments.ts";

export const ExperienceId = z.string().uuid().brand<"ExperienceId">();
export type ExperienceId = z.infer<typeof ExperienceId>;
export const ScopeId = z.string().uuid().brand<"ExperienceScopeId">();
export type ScopeId = z.infer<typeof ScopeId>;
export const JobId = z.string().uuid().brand<"ExperienceJobId">();
export type JobId = z.infer<typeof JobId>;
export const ExperienceLayout = z.enum([
  "single",
  "bots",
  "channels",
  "sessions",
]);
export type ExperienceLayout = z.infer<typeof ExperienceLayout>;
const Label = z.string().trim().min(1).max(100);
const Purpose = z.string().trim().min(1).max(4000);
export const Avatar = z.string().regex(/^bot-\d{2}$/);
export const ScopePlan = z
  .object({
    label: Label,
    purpose: Purpose,
    avatar: Avatar.optional(),
  })
  .strict();
export const ExperiencePlan = z
  .object({
    layout: ExperienceLayout,
    title: Label,
    assistantName: Label,
    purpose: Purpose,
    scopes: z.array(ScopePlan).min(1).max(20),
  })
  .strict()
  .refine(
    (plan) => plan.layout !== "single" || plan.scopes.length === 1,
    "A central chat has one conversation.",
  );
export type ExperiencePlan = z.infer<typeof ExperiencePlan>;
export const ProposalSource = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("legacy") }),
  z.strictObject({ kind: z.literal("manual") }),
  z.strictObject({
    kind: z.literal("conversation"),
    conversationId: z.string().min(1),
  }),
]);
export const ProposalMetadata = z.strictObject({
  version: z.literal(1),
  createdAt: z.iso.datetime(),
  source: ProposalSource,
  answerMessageId: z.string().min(1).optional(),
  dismissedAt: z.iso.datetime().optional(),
  supersededBy: ExperienceId.optional(),
});
export type ProposalMetadata = z.infer<typeof ProposalMetadata>;
export const ExperienceMain = z.strictObject({
  version: z.literal(1),
  profileId: ExperienceId.nullable(),
  setAt: z.iso.datetime(),
});
export const ExperienceMainSelect = z.strictObject({
  profileId: ExperienceId.nullable(),
});
export const Experience = z.object({
  id: ExperienceId,
  revision: z.number().int().nonnegative(),
  kind: z.enum(["proposed", "ready"]),
  plan: ExperiencePlan,
  proposal: ProposalMetadata.optional(),
});
export type Experience = z.infer<typeof Experience>;
export const ExperienceScope = z.object({
  id: ScopeId,
  profileId: ExperienceId,
  label: Label,
  purpose: Purpose,
  avatar: Avatar.optional(),
  createdAt: z.string(),
});
export type ExperienceScope = z.infer<typeof ExperienceScope>;
export const Citation = z.object({
  url: z.url().refine((url) => /^https?:\/\//.test(url)),
  title: z.string().max(1000),
});
export const Activity = z.object({
  id: z.string().max(256),
  callId: z.string().max(256),
  description: z.string().trim().min(1).max(160),
  kind: z.enum(["machine", "desktop", "search", "file", "delegate", "other"]),
});
export type Activity = z.infer<typeof Activity>;
export const JobState = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("queued"), acceptedAt: z.string() }),
  z.object({
    kind: z.literal("running"),
    startedAt: z.string(),
    activity: z.array(Activity),
  }),
  z.object({
    kind: z.literal("stopping"),
    requestedAt: z.string(),
    activity: z.array(Activity),
  }),
  z.object({
    kind: z.literal("completed"),
    finishedAt: z.string(),
    text: z.string(),
    citations: z.array(Citation),
  }),
  z.object({
    kind: z.literal("stopped"),
    finishedAt: z.string(),
    partialText: z.string(),
  }),
  z.object({
    kind: z.literal("failed"),
    finishedAt: z.string(),
    partialText: z.string(),
    message: z.string(),
  }),
  z.object({
    kind: z.literal("interrupted"),
    interruptedAt: z.string(),
    partialText: z.string(),
  }),
  z.object({
    kind: z.literal("uncertain"),
    interruptedAt: z.string(),
    partialText: z.string(),
    message: z.string(),
    invocationIds: z.array(z.string()).min(1),
  }),
]);
export type JobState = z.infer<typeof JobState>;
export const ExperienceJob = z.object({
  id: JobId,
  profileId: ExperienceId,
  scopeId: ScopeId,
  requestId: z.string().uuid(),
  messageId: z.string(),
  answerId: z.string(),
  parentId: JobId.optional(),
  dispatchedEffect: z.literal(true).optional(),
  title: Label,
  contextRevision: z.number().int().nonnegative(),
  state: JobState,
});
export type ExperienceJob = z.infer<typeof ExperienceJob>;
export const ExperienceCapabilities = z.object({
  machine: z.boolean(),
  desktop: z.boolean(),
  search: z.boolean(),
  selfModification: z.boolean(),
});
export const ExperienceIndex = z.object({
  version: z.literal(1),
  profiles: z.array(Experience),
  capabilities: ExperienceCapabilities,
});
export type ExperienceIndex = z.infer<typeof ExperienceIndex>;
export const ExperienceState = z.object({
  version: z.literal(1),
  profile: Experience,
  revision: z.number().int().nonnegative(),
  scopes: z.array(ExperienceScope),
  jobs: z.array(ExperienceJob),
  capabilities: ExperienceCapabilities,
});
export type ExperienceState = z.infer<typeof ExperienceState>;
export const ExperienceScopeState = z.object({
  version: z.literal(1),
  profileId: ExperienceId,
  scope: ExperienceScope,
  revision: z.number().int().nonnegative(),
  messages: z.array(Message),
  jobs: z.array(ExperienceJob),
  chat: Chat,
  memoryRevision: z.number().int().nonnegative(),
});
export type ExperienceScopeState = z.infer<typeof ExperienceScopeState>;
export const ExperienceCreate = z
  .object({ requestId: z.string().uuid(), plan: ExperiencePlan, selection: ModelSelection.optional() })
  .strict();
export const ExperienceConfirm = z
  .object({ revision: z.number().int().nonnegative() })
  .strict();
export const ExperienceSend = z
  .object({
    requestId: z.string().uuid(),
    text: z.string().trim().max(32000),
    attachments: z.array(AttachmentId).max(imageLimits.count).optional(),
  })
  .strict()
  .refine(
    (input) => input.text.length > 0 || Boolean(input.attachments?.length),
    "Enter a message or attach an image.",
  );
export type ExperienceSend = z.infer<typeof ExperienceSend>;
export const ExperienceAdmission = z.object({
  profileId: ExperienceId,
  scopeId: ScopeId,
  messageId: z.string(),
  jobId: JobId,
  state: JobState,
});
export type ExperienceAdmission = z.infer<typeof ExperienceAdmission>;
export const ExperienceRetry = z
  .object({
    requestId: z.string().uuid(),
    repeatUncertain: z.literal(true).optional(),
    repeatEffects: z.literal(true).optional(),
  })
  .strict();
export const ExperienceSelection = ModelSelection;
export const ExperienceAttachment = Attachment;
