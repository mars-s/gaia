import { z } from "zod";
export const Message = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  createdAt: z.string(),
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
export const Snapshot = z.object({ thread: Thread, connection: Connection });
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
