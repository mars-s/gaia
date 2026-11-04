import { z } from "zod";
export const ThinkingLevel = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type ThinkingLevel = z.infer<typeof ThinkingLevel>;
export const ChatSelection = z.object({
  modelId: z.string().min(1).max(256),
  thinkingLevel: ThinkingLevel.optional(),
});
export const Message = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  createdAt: z.string(),
  selection: ChatSelection.optional(),
});
export type Message = z.infer<typeof Message>;
export const Run = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("idle") }),
  z.object({ kind: z.literal("running"), id: z.string() }),
  z.object({ kind: z.literal("stopped") }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export const Thread = z.object({
  version: z.literal(1),
  id: z.literal("local"),
  messages: z.array(Message),
  run: Run,
});
export type Thread = z.infer<typeof Thread>;
export const Connection = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("connected"), model: z.literal("gpt-6.1-sol") }),
  z.object({ kind: z.literal("disconnected"), message: z.string() }),
  z.object({
    kind: z.literal("connecting"),
    url: z.string().optional(),
    prompt: z.string().optional(),
  }),
]);
export type Connection = z.infer<typeof Connection>;
export const Runtime = z.object({
  release: z.string(),
  mode: z.string(),
  selfModification: z.boolean(),
});
export const Chat = z.object({
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      contextWindow: z.number(),
      capabilities: z
        .object({
          images: z.boolean(),
          thinkingLevels: z.array(ThinkingLevel),
        })
        .optional(),
    }),
  ),
  modelId: z.string(),
  thinkingLevel: ThinkingLevel.optional(),
  compaction: z.object({
    kind: z.enum(["idle", "running", "done", "noop", "error"]),
    message: z.string().optional(),
  }),
});
export type Chat = z.infer<typeof Chat>;
export const ModelSelection = z
  .object({
    modelId: z.string().min(1).max(256),
    thinkingLevel: ThinkingLevel.optional(),
  })
  .strict();
export const Snapshot = z.object({
  thread: Thread,
  connection: Connection,
  runtime: Runtime.optional(),
  chat: Chat.optional(),
});
export type Snapshot = z.infer<typeof Snapshot>;
export const Event = z.object({ type: z.literal("snapshot"), data: Snapshot });
export const Send = z
  .object({
    requestId: z.string().uuid(),
    text: z.string().trim().min(1).max(32000),
  })
  .strict();
export const AuthReply = z
  .object({ value: z.string().min(1).max(4096) })
  .strict();
export const ApiError = z.object({ error: z.string() });

export const Empty = z.object({}).strict();
