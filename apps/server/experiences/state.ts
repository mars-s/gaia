import { z } from "zod";
import {
  defineDoc,
  type ConversationId,
  type TaskId,
} from "@earendil-works/pi-durable";
import { Chat, Message } from "../../../packages/protocol/index.ts";
import {
  Experience,
  ExperienceJob,
  ExperienceScope,
  ExperienceSend,
} from "../../../packages/protocol/experiences.ts";
const conversationId = z.custom<ConversationId>(
  (v) => Number.isSafeInteger(v) && Number(v) > 0,
);
const taskId = z.custom<TaskId>(
  (v) => Number.isSafeInteger(v) && Number(v) > 0,
);
export const Fact = z.object({
  revision: z.number(),
  scopeId: z.string(),
  jobId: z.string(),
  key: z.string(),
  value: z.string(),
  createdAt: z.string(),
});
export const Scope = z.object({
  public: ExperienceScope,
  conversationId,
  chat: Chat,
  messages: z.array(Message),
  ledger: z.array(
    z.object({
      jobId: z.string(),
      kind: z.enum(["input", "result"]),
      status: z.enum(["pending", "terminal"]).optional(),
      text: z.string(),
      revision: z.number(),
    }),
  ),
  revision: z.number(),
  contextBase: z.string().default(""),
  compactedRevision: z.number().default(0),
});
export const Job = z.object({
  public: ExperienceJob,
  input: ExperienceSend,
  digest: z.string(),
  taskId,
  workerId: conversationId,
  depth: z.number(),
  context: z.string(),
  memoryRevision: z.number(),
  selection: Chat.pick({ modelId: true, thinkingLevel: true }),
  partialText: z.string(),
  invocations: z.array(z.string()),
  receipts: z
    .array(z.object({ callId: z.string(), result: z.string() }))
    .default([]),
});
export const State = z.object({
  profile: Experience.nullable(),
  createDigest: z.string(),
  revision: z.number(),
  scopes: z.array(Scope),
  jobs: z.array(Job),
  memory: z.array(Fact),
});
export type State = z.infer<typeof State>;
export type StoredJob = z.infer<typeof Job>;
export const ProfileDoc = defineDoc<State>({
  kind: "gaia.experience",
  version: 1,
  scope: "session",
  initial: () => ({
    profile: null,
    createDigest: "",
    revision: 0,
    scopes: [],
    jobs: [],
    memory: [],
  }),
  checkpointWhen: () => true,
});
export const terminal = (job: ExperienceJob) =>
  !["queued", "running", "stopping"].includes(job.state.kind);
export const now = () => new Date().toISOString();
