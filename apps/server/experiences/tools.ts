import { z } from "zod";
import {
  defineTool,
  type Tx,
  type ToolExecutionApi,
} from "@earendil-works/pi-durable";
import {
  JobId,
  ScopeId,
  type ExperienceSend,
  type ExperienceAdmission,
  type ExperienceJob,
} from "../../../packages/protocol/experiences.ts";
import { State, type StoredJob, now } from "./state.ts";
import { HttpError } from "../http-error.ts";

type Bindings = {
  read(): Promise<State>;
  mutate<T>(change: (state: State, tx: Tx) => Promise<T> | T): Promise<T>;
  scopeIn(state: State, id: string): State["scopes"][number];
  jobIn(state: State, id: string): StoredJob;
  namespace(state: State, id: string): string;
  memory(state: State, id: string): State["memory"];
  send(
    scopeId: string,
    input: ExperienceSend,
    parentId?: string,
  ): Promise<ExperienceAdmission>;
  wait(jobId: string): Promise<ExperienceJob>;
  stop(jobId: string): Promise<ExperienceJob>;
};
export function createExperienceTools(bindings: Bindings) {
  const description = z.string().trim().min(1).max(160);
  async function owner(api: ToolExecutionApi) {
    const state = await bindings.read();
    const job = state.jobs.find((j) => j.workerId === api.conversationId);
    if (!job) throw new HttpError(404, "Tool has no experience owner.");
    return { state, job };
  }
  const result = (value: unknown) => ({
    output: [{ type: "text" as const, text: JSON.stringify(value) }],
  });
  const tools = [
    defineTool({
      name: "remember_fact",
      description:
        "Store an explicit fact with source job and scope provenance. Use expectedRevision from read_memory.",
      parameters: z.toJSONSchema(
        z.strictObject({
          key: z.string().min(1).max(200),
          value: z.string().max(4000),
          expectedRevision: z.number().int().nonnegative(),
          description,
        }),
      ),
      async execute(raw, api, ctx) {
        const input = z
          .object({
            key: z.string(),
            value: z.string(),
            expectedRevision: z.number(),
            description,
          })
          .parse(raw);
        const { job } = await owner(api);
        await api.details(
          { description: input.description, kind: "other" },
          ctx,
        );
        return result(
          await bindings.mutate((state) => {
            const facts = bindings.memory(state, job.public.scopeId);
            if ((facts.at(-1)?.revision ?? 0) !== input.expectedRevision)
              throw new HttpError(
                409,
                "Memory revision changed. Read it again.",
              );
            const fact = {
              revision: state.memory.length + 1,
              scopeId: job.public.scopeId,
              jobId: job.public.id,
              key: input.key,
              value: input.value,
              createdAt: now(),
            };
            state.memory.push(fact);
            return fact;
          }),
        );
      },
    }),
    defineTool({
      name: "read_memory",
      description:
        "Read explicit versioned facts in this scope's permitted namespace. No other transcripts are included.",
      parameters: z.toJSONSchema(z.strictObject({})),
      async execute(_input, api) {
        const { state, job } = await owner(api);
        return result(
          bindings
            .memory(state, job.public.scopeId)
            .filter((f) => f.revision <= job.memoryRevision),
        );
      },
    }),
    defineTool({
      name: "retrieve_context",
      description:
        "Search admitted scope history, with job provenance. Other scopes require an explicit scopeId selection. Never reads another profile.",
      parameters: z.toJSONSchema(
        z.strictObject({
          query: z.string().max(200),
          scopeId: ScopeId.optional(),
        }),
      ),
      async execute(raw, api) {
        const input = z
          .object({ query: z.string(), scopeId: ScopeId.optional() })
          .parse(raw);
        const { state, job } = await owner(api);
        const scopeId = input.scopeId ?? job.public.scopeId;
        const scope = bindings.scopeIn(state, scopeId);
        return result(
          scope.ledger
            .filter(
              (entry) =>
                (scopeId !== job.public.scopeId ||
                  entry.revision <= job.public.contextRevision) &&
                entry.text.toLowerCase().includes(input.query.toLowerCase()),
            )
            .slice(-30),
        );
      },
    }),
    defineTool({
      name: "spawn_agent",
      description:
        "Start real subordinate work with explicit selected context, up to three levels and eight children per job. Returns a durable job ID.",
      parameters: z.toJSONSchema(
        z.strictObject({
          requestId: z.string().uuid(),
          scopeId: ScopeId.optional(),
          text: z.string().min(1).max(32000),
          description,
        }),
      ),
      async execute(raw, api, ctx) {
        const input = z
          .object({
            requestId: z.string().uuid(),
            scopeId: ScopeId.optional(),
            text: z.string(),
            description,
          })
          .parse(raw);
        const { job } = await owner(api);
        await api.details(
          { description: input.description, kind: "delegate" },
          ctx,
        );
        return result(
          await bindings.send(
            input.scopeId ?? job.public.scopeId,
            { requestId: input.requestId, text: input.text },
            job.public.id,
          ),
        );
      },
    }),
    ...["read_agent", "wait_agent", "stop_agent"].map((name) =>
      defineTool({
        name,
        description:
          "Read, join or stop a subordinate job belonging to this job. Cannot control unrelated work.",
        parameters: z.toJSONSchema(
          z.strictObject({ jobId: JobId, description }),
        ),
        async execute(raw, api, ctx) {
          const input = z.object({ jobId: JobId, description }).parse(raw);
          const { state, job } = await owner(api);
          const child = bindings.jobIn(state, input.jobId);
          if (child.public.parentId !== job.public.id)
            throw new HttpError(404, "Unknown subordinate job.");
          await api.details(
            { description: input.description, kind: "delegate" },
            ctx,
          );
          if (name === "wait_agent")
            return result(await bindings.wait(input.jobId));
          if (name === "stop_agent")
            return result(await bindings.stop(input.jobId));
          return result(child.public);
        },
      }),
    ),
  ];
  return { tools };
}
