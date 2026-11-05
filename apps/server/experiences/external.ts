import type { Extension } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  ToolInvocationFailure,
  receiptEvidence,
  observeEffectDispatch,
} from "../experience-tools/index.ts";
import { effectClassOf } from "../experience-tools/effect-class.ts";
import { ProfileDoc, type State } from "./state.ts";

function markEffect(doc: { jobs: State["jobs"] }, job: State["jobs"][number]) {
  let current: State["jobs"][number] | undefined = job;
  while (current) {
    current.public.dispatchedEffect = true;
    const parentId: string | undefined = current.public.parentId;
    current = parentId
      ? doc.jobs.find((j) => j.public.id === parentId)
      : undefined;
  }
}

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
          if (
            effectClassOf(tool) !== "read" &&
            !job.invocations.includes(invocationId)
          )
            job.invocations.push(invocationId);
          if (effectClassOf(tool) === undefined) markEffect(doc, job);
        }, context);
        let reviewRequired = false;
        let evidence: ReturnType<typeof receiptEvidence>;
        const stopObserving = observeEffectDispatch(api, async () => {
          await api.commit(async (tx) => {
            const doc = await tx.doc(ProfileDoc);
            const job = doc.jobs.find((j) => j.workerId === api.conversationId);
            if (job) markEffect(doc, job);
          }, BACKGROUND_CONTEXT);
        });
        const result = await tool
          .execute(input, api, context)
          .catch((error: unknown) => {
            if (!(error instanceof ToolInvocationFailure)) {
              if (effectClassOf(tool) !== "read") throw error;
              return {
                isError: true,
                output: [{ type: "text" as const, text: String(error) }],
              };
            }
            evidence = error.receipt;
            reviewRequired =
              error.receipt.state === "unknown" ||
              error.receipt.state === "intent";
            return {
              isError: true,
              output: error.receipt.result
                ? [
                    {
                      type: "text" as const,
                      text: JSON.stringify(error.receipt.result),
                    },
                  ]
                : [{ type: "text" as const, text: error.message }],
              details: { receipt: error.receipt },
            };
          })
          .finally(stopObserving);
        evidence ??= receiptEvidence(result);
        await api.commit(async (tx) => {
          const doc = await tx.doc(ProfileDoc);
          const job = doc.jobs.find((j) => j.workerId === api.conversationId);
          if (job) {
            if (
              evidence?.effectClass === "effect" &&
              evidence.dispatched === true
            )
              markEffect(doc, job);
            job.receipts.push({
              callId: invocationId,
              result: JSON.stringify({
                ...result,
                ...(evidence ? { hostReceipt: evidence } : {}),
              }),
            });
            if (!reviewRequired)
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
