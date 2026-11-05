import type { Extension } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ToolInvocationFailure } from "../experience-tools/index.ts";
import { ProfileDoc } from "./state.ts";

export function trackedExtension(extension: Extension): Extension {
  return {
    ...extension,
    tools: extension.tools?.map((tool) => ({
      ...tool,
      replay: "unsafe",
      async execute(input, api, context) {
        const invocationId = `${api.conversationId}/${api.callId}`;
        await api.commit(async (tx) => {
          const doc = await tx.doc(ProfileDoc);
          const job = doc.jobs.find((j) => j.workerId === api.conversationId);
          if (!job) throw new Error("Tool has no job owner.");
          if (!job.invocations.includes(invocationId))
            job.invocations.push(invocationId);
        }, context);
        const result = await tool
          .execute(input, api, context)
          .catch((error: unknown) => {
            if (
              !(error instanceof ToolInvocationFailure) ||
              error.receipt.state === "unknown" ||
              error.receipt.state === "intent"
            )
              throw error;
            return {
              isError: true,
              output: [{ type: "text" as const, text: error.message }],
              details: { receipt: error.receipt },
            };
          });
        await api.commit(async (tx) => {
          const doc = await tx.doc(ProfileDoc);
          const job = doc.jobs.find((j) => j.workerId === api.conversationId);
          if (job) {
            job.receipts.push({
              callId: invocationId,
              result: JSON.stringify(result),
            });
            job.invocations = job.invocations.filter(
              (id) => id !== invocationId,
            );
          }
        }, BACKGROUND_CONTEXT);
        return result;
      },
    })),
  };
}
