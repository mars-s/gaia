import { z } from "zod";

const Issue = z.object({ issue: z.string().min(1).max(500), shots: z.array(z.string().min(1).max(120)).min(1).max(10) }).strict();
export const ChangeCritique = z.object({ critic: z.preprocess(value => value === "fresh" ? "advisory" : value, z.literal("advisory")), score: z.number().min(0).max(10), summary: z.string().min(1).max(500), blocking: z.array(Issue).max(5), minor: z.array(Issue).max(10) }).strict();
export const ChangeSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("original"), answerMessageId: z.string().min(1).max(200) }),
  z.object({ kind: z.literal("experience"), profileId: z.string().uuid(), scopeId: z.string().uuid(), answerMessageId: z.string().min(1).max(200) }),
]);
export type ChangeSource = z.infer<typeof ChangeSource>;
export const ChangePreviews = z.object({ surfaces: z.array(z.object({ name: z.string() })).optional(), shots: z.array(z.object({ name: z.string(), scenario: z.string(), width: z.number(), theme: z.enum(["light", "dark"]), before: z.string().regex(/^before-[a-z0-9-]+\.jpg$/), after: z.string().regex(/^after-[a-z0-9-]+\.jpg$/) })), alsoChanged: z.array(z.string()) });
