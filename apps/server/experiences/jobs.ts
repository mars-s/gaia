import { z } from "zod";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { defineTask, type Harness, type Tx } from "@earendil-works/pi-durable";
import {
  ExperienceJob,
  Citation,
} from "../../../packages/protocol/experiences.ts";
import { ProfileDoc, State, terminal, now } from "./state.ts";
import { HttpError } from "../http-error.ts";
import { conversationAdapter } from "../pi-conversation.ts";
import { Images } from "./images.ts";
import type { ProfileOptions } from "./profile.ts";
function citations(job: State["jobs"][number]) {
  const result = job.receipts.flatMap((receipt) => {
    const value = z
      .object({
        details: z
          .object({ citations: z.array(Citation).optional() })
          .passthrough()
          .optional(),
        structuredOutput: z
          .object({ citations: z.array(Citation).optional() })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .safeParse(JSON.parse(receipt.result));
    return value.success
      ? [
          ...(value.data.details?.citations ?? []),
          ...(value.data.structuredOutput?.citations ?? []),
        ]
      : [];
  });
  return [
    ...new Map(result.map((citation) => [citation.url, citation])).values(),
  ];
}
function uncertain(job: State["jobs"][number]): ExperienceJob["state"] {
  return {
    kind: "uncertain",
    interruptedAt: now(),
    partialText: job.partialText,
    message:
      "A tool invocation has no durable receipt. Review it before repeating effects.",
    invocationIds: job.invocations,
  };
}
export type Mutate = <T>(
  change: (state: State, tx: Tx) => Promise<T> | T,
) => Promise<T>;
export function scopeIn(state: State, scopeId: string) {
  const scope = state.scopes.find((s) => s.public.id === scopeId);
  if (!scope) throw new HttpError(404, "Unknown experience scope.");
  return scope;
}
export function jobIn(state: State, jobId: string) {
  const job = state.jobs.find((j) => j.public.id === jobId);
  if (!job) throw new HttpError(404, "Unknown experience job.");
  return job;
}
async function settle(tx: Tx, jobId: string, outcome: ExperienceJob["state"]) {
  const doc = await tx.doc(ProfileDoc);
  const state = State.parse(doc);
  const job = jobIn(state, jobId);
  if (terminal(job.public)) return;
  if (outcome.kind === "completed" && job.public.state.kind === "stopping")
    outcome = {
      kind: "stopped",
      finishedAt: now(),
      partialText: job.partialText,
    };
  job.public.state = outcome;
  const scope = scopeIn(state, job.public.scopeId);
  const text = outcome.kind === "completed" ? outcome.text : job.partialText;
  const answer = scope.messages.find((m) => m.id === job.public.answerId);
  if (answer) answer.text = text;
  scope.revision++;
  scope.ledger.push({
    jobId,
    kind: "result",
    status: "terminal",
    text: JSON.stringify({ state: outcome, text }),
    revision: scope.revision,
  });
  await tx.appendEntry(scope.conversationId, {
    kind: "gaia.job-result",
    data: { jobId, state: outcome },
    model: [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: JSON.stringify({ jobId, state: outcome, text }),
          },
        ],
        api: "openai-codex-responses",
        provider: "openai-codex",
        model: job.selection.modelId,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      },
    ],
  });
  state.revision++;
  Object.assign(doc, state);
}

export function createJobTask({
  getHarness,
  options,
  read,
  mutate,
  controls,
  joinChildren,
  stopChildren,
  publish,
}: {
  getHarness(): Harness;
  options: ProfileOptions;
  read(): Promise<State>;
  mutate: Mutate;
  controls: Map<string, AbortController>;
  joinChildren(id: string): Promise<void>;
  stopChildren(id: string): Promise<void>;
  publish(): void;
}) {
  return defineTask<{ jobId: string }, { phase: "execute" }, null>({
    name: "gaia.experience-job",
    version: 1,
    initial: () => ({ phase: "execute" }),
    phases: {
      execute: async (task, runtime, context) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        runtime.signal.addEventListener("abort", abort, { once: true });
        if (runtime.signal.aborted) abort();
        controls.set(task.input.jobId, controller);
        let release: (() => void) | undefined;
        try {
          const initial = jobIn(await read(), task.input.jobId);
          release = await options.capacity.acquire(
            initial.depth,
            controller.signal,
          );
          controller.signal.throwIfAborted();
          await mutate((state) => {
            const job = jobIn(state, task.input.jobId);
            job.public.state = {
              kind: "running",
              startedAt: now(),
              activity: [],
            };
          });
          const worker = await getHarness().conversation(initial.workerId, ctx);
          if (!worker) throw new Error("Job worker is missing.");
          const adapter = await conversationAdapter(
            worker,
            getHarness(),
            options.models,
            ctx,
          );
          const images = await getHarness().snapshot(Images, ctx);
          const files = (initial.input.attachments ?? []).map((fileId) => {
            const file = images?.images.find(
              (f) =>
                f.scopeId === initial.public.scopeId &&
                f.attachment.id === fileId,
            );
            if (!file) throw new HttpError(404, "Unknown scoped image.");
            return {
              type: "image" as const,
              data: file.data,
              mimeType: file.attachment.mimeType,
            };
          });
          let progress = Promise.resolve();
          let projectionError: unknown;
          const watch = await worker.watch(ctx);
          watch.start(async (call) => {
            if (call.kind !== "value") return;
            const live = z
              .object({
                tools: z
                  .array(
                    z.object({
                      callId: z.string(),
                      status: z.string(),
                      details: z.unknown().optional(),
                    }),
                  )
                  .optional(),
              })
              .passthrough()
              .safeParse(call.value.docs["pi.live"]);
            if (!live.success) return;
            const activity = (live.data.tools ?? [])
              .filter((slot) => slot.status === "running")
              .flatMap((slot) => {
                const details = z
                  .object({
                    description: z.string().trim().min(1).max(160),
                    kind: z
                      .enum([
                        "machine",
                        "desktop",
                        "search",
                        "file",
                        "delegate",
                        "other",
                      ])
                      .default("other"),
                  })
                  .safeParse(slot.details);
                return details.success
                  ? [
                      {
                        id: `${initial.public.id}/${slot.callId}`,
                        callId: slot.callId,
                        ...details.data,
                      },
                    ]
                  : [];
              });
            await mutate((state) => {
              const job = jobIn(state, task.input.jobId);
              if (
                job.public.state.kind === "running" ||
                job.public.state.kind === "stopping"
              )
                job.public.state.activity = activity;
            });
          });
          try {
            await adapter.run({
              text: initial.input.text,
              images: files,
              requestId: initial.input.requestId,
              signal: controller.signal,
              onText: (text) => {
                progress = progress
                  .then(() =>
                    mutate((state) => {
                      const job = jobIn(state, task.input.jobId);
                      job.partialText = text;
                      const answer = scopeIn(
                        state,
                        job.public.scopeId,
                      ).messages.find((m) => m.id === job.public.answerId);
                      if (answer) answer.text = text;
                    }),
                  )
                  .catch((error) => {
                    projectionError = error;
                    controller.abort();
                  });
              },
            });
            await progress;
            if (projectionError) throw projectionError;
          } finally {
            await watch.stop();
            await progress;
          }
          if (projectionError) throw projectionError;
          controller.signal.throwIfAborted();
          // A parent owns its entire subtree, including children it did not explicitly wait for.
          await joinChildren(task.input.jobId);
          controller.signal.throwIfAborted();
          const final = jobIn(await read(), task.input.jobId);
          await runtime.commit(async (tx) => {
            await settle(
              tx,
              task.input.jobId,
              final.invocations.length
                ? uncertain(final)
                : {
                    kind: "completed",
                    finishedAt: now(),
                    text: final.partialText,
                    citations: citations(final),
                  },
            );
            return {
              status: "terminal",
              outcome: { status: "completed", result: null },
            };
          }, context);
        } catch (error) {
          if (runtime.signal.aborted) throw error;
          const final = jobIn(await read(), task.input.jobId);
          await stopChildren(task.input.jobId);
          await runtime.commit(async (tx) => {
            await settle(
              tx,
              task.input.jobId,
              final.invocations.length
                ? uncertain(final)
                : controller.signal.aborted
                  ? {
                      kind: "stopped",
                      finishedAt: now(),
                      partialText: final.partialText,
                    }
                  : {
                      kind: "failed",
                      finishedAt: now(),
                      partialText: final.partialText,
                      message:
                        error instanceof Error ? error.message : "Job failed.",
                    },
            );
            return {
              status: "terminal",
              outcome: { status: "completed", result: null },
            };
          }, context);
        } finally {
          release?.();
          controls.delete(task.input.jobId);
          runtime.signal.removeEventListener("abort", abort);
          publish();
        }
      },
    },
    abort: async (task, runtime, context) => {
      await runtime.commit(async (tx) => {
        const state = State.parse(await tx.doc(ProfileDoc));
        const job = jobIn(state, task.input.jobId);
        await settle(
          tx,
          task.input.jobId,
          job.invocations.length
            ? {
                kind: "uncertain",
                interruptedAt: now(),
                partialText: job.partialText,
                message:
                  "Work was interrupted during a tool invocation. Review its receipt before repeating.",
                invocationIds: job.invocations,
              }
            : job.public.state.kind === "stopping"
              ? {
                  kind: "stopped",
                  finishedAt: now(),
                  partialText: job.partialText,
                }
              : {
                  kind: "interrupted",
                  interruptedAt: now(),
                  partialText: job.partialText,
                },
        );
        return {
          status: "terminal",
          outcome: { status: "completed", result: null },
        };
      }, context);
    },
  });
}
