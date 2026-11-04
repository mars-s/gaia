import { z } from "zod";

export const OwnerProfile = z.strictObject({
  name: z.string().trim().min(1).max(100),
  purpose: z.string().trim().min(1).max(1000),
  lifeAreas: z.array(z.string().trim().min(1).max(100)).max(12),
  workingStyle: z.enum(["chat", "balanced", "agentic"]),
  approvalPreferences: z.string().trim().min(1).max(1000).optional(),
});
export type OwnerProfile = z.infer<typeof OwnerProfile>;
export const OwnerAnswers = OwnerProfile.partial();
export type OwnerAnswers = z.infer<typeof OwnerAnswers>;
export const OwnerAnswerUpdate = OwnerAnswers.refine(
  (answers) => Object.values(answers).some((value) => value !== undefined),
  "Include at least one explicit answer.",
);
export const OwnerState = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new") }),
  z.strictObject({
    kind: z.literal("interview"),
    answers: OwnerAnswers.optional(),
    startedAt: z.string().datetime().optional(),
  }),
  z.strictObject({
    kind: z.literal("proposed"),
    proposalId: z.string().uuid(),
    profile: OwnerProfile,
  }),
  z.strictObject({ kind: z.literal("ready"), profile: OwnerProfile }),
  z.strictObject({ kind: z.literal("skipped") }),
]);
export type OwnerState = z.infer<typeof OwnerState>;
export const ProfileConfirmation = z.strictObject({
  proposalId: z.string().uuid(),
});
export interface OwnerCapability {
  read(): OwnerState | undefined;
  propose(profile: OwnerProfile): void;
  record?(answers: OwnerAnswers): void;
}

const questions = [
  ["name", "What should Gaia call you?"],
  ["purpose", "What would you most like Gaia to help you with?"],
  [
    "lifeAreas",
    "Which parts of your life should Gaia help with? You can also say none for now.",
  ],
  [
    "workingStyle",
    "Would you prefer to chat things through, get balanced help, or have Gaia take initiative within an agreed scope?",
  ],
  [
    "approvalPreferences",
    "Which actions should Gaia ask you to approve first?",
  ],
] satisfies [keyof OwnerAnswers, string][];

export function nextOwnerQuestion(answers: OwnerAnswers = {}) {
  return questions.find(([key]) => answers[key] === undefined)?.[1];
}

export function interviewQuestionVisible(
  state: Extract<OwnerState, { kind: "interview" }>,
  messages: { role: string; createdAt: string }[],
) {
  return (
    !messages.some(
      (message) =>
        message.role === "user" &&
        (!state.startedAt || message.createdAt >= state.startedAt),
    ) && !Object.keys(state.answers ?? {}).length
  );
}

export function createProfileReader(
  receive: (state: OwnerState) => void,
  failed: () => void,
  request: typeof fetch = fetch,
) {
  let current: AbortController | undefined;
  function cancel() {
    current?.abort();
    current = undefined;
  }
  return {
    cancel,
    async refresh() {
      cancel();
      const controller = new AbortController();
      current = controller;
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await request("/api/v1/profile", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Profile unavailable");
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Profile unavailable");
        let text = "";
        let bytes = 0;
        const decoder = new TextDecoder();
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > 16384) throw new Error("Profile too large");
            text += decoder.decode(chunk.value, { stream: true });
          }
          text += decoder.decode();
        } finally {
          await reader.cancel();
        }
        const state = OwnerState.parse(JSON.parse(text));
        if (current === controller && !controller.signal.aborted)
          receive(state);
      } catch {
        if (current === controller) failed();
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
