import type { Extension } from "@earendil-works/pi-durable";
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
        const result = await tool.execute(input, api, context);
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
        }, context);
        return result;
      },
    })),
  };
}
