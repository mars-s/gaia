import { digest } from "./storage.ts";
import { createAdmission } from "./admission.ts";
import { createJobTask, scopeIn, jobIn } from "./jobs.ts";
import { Images, createImages } from "./images.ts";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import {
  configure,
  createRegistry,
  defineExtension,
  type Extension,
  type HarnessSettings,
  type HarnessOptions,
  type Tx,
  type ConversationId,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { Models } from "@earendil-works/pi-ai";
import {
  ExperienceId,
  ScopeId,
  ExperienceScopeState,
  ExperienceCreate,
  type ExperienceSend,
  ExperienceRetry,
  ScopePlan,
  ExperienceCapabilities,
} from "../../../packages/protocol/experiences.ts";
import type { ModelSelection } from "../../../packages/protocol/index.ts";
import { openRecoveredHarness } from "../workspace-recovery.ts";
import { conversationAdapter } from "../pi-conversation.ts";
import { effortLevels } from "../model-effort.ts";
import { HttpError } from "../http-error.ts";
import { ProfileDoc, State, Scope, terminal, now } from "./state.ts";
import { Capacity } from "./capacity.ts";
import { createExperienceTools } from "./tools.ts";
import { trackedExtension } from "./external.ts";
import { defaultAvatar } from "./avatars.ts";
import type { OwnerState } from "../../../packages/sdk/onboarding.ts";

export type ProfileOptions = {
  models: Models;
  readOwner?(): OwnerState | undefined;
  env?: HarnessOptions["env"];
  extensions?: Extension[];
  extensionsForJob?(binding: {
    profileId: ExperienceId;
    scopeId: ScopeId;
    jobId: string;
    conversationId: ConversationId;
  }): readonly Extension[] | Promise<readonly Extension[]>;
  capabilities:
    | z.infer<typeof ExperienceCapabilities>
    | (() => z.infer<typeof ExperienceCapabilities>);
  capacity: Capacity;
  settings?: Pick<HarnessSettings, "compaction">;
};
export async function openProfile(
  path: string,
  id: ExperienceId,
  options: ProfileOptions,
) {
  let admissionOpen = true;
  const controls = new Map<string, AbortController>();
  const compacting = new Set<string>();
  const operations = new Set<Promise<unknown>>();
  const listeners = new Set<() => void>();
  const read = async () => State.parse(await harness.snapshot(ProfileDoc, ctx));
  const publish = () => {
    for (const listener of listeners) listener();
  };
  async function track<T>(work: () => Promise<T>): Promise<T> {
    gate();
    const operation = work();
    operations.add(operation);
    try {
      return await operation;
    } finally {
      operations.delete(operation);
    }
  }
  async function mutate<T>(change: (state: State, tx: Tx) => Promise<T> | T) {
    const value = await harness.commit(async (tx) => {
      const doc = await tx.doc(ProfileDoc);
      const state = State.parse(doc);
      const result = await change(state, tx);
      state.revision++;
      Object.assign(doc, state);
      return result;
    }, ctx);
    publish();
    return value;
  }
  function gate() {
    if (!admissionOpen)
      throw new HttpError(503, "Experience admission is closed.");
  }
  function namespace(state: State, scopeId: string) {
    return ["single", "channels"].includes(state.profile?.plan.layout ?? "")
      ? "shared"
      : scopeId;
  }
  function memory(state: State, scopeId: string) {
    return state.memory.filter(
      (f) => namespace(state, f.scopeId) === namespace(state, scopeId),
    );
  }
  const anchor = createJobTask({
    getHarness: () => harness,
    options,
    read,
    mutate,
    controls,
    joinChildren,
    stopChildren,
    publish,
    prepareWorker,
  });
  const send = createAdmission({
    id,
    gate,
    mutate,
    compacting,
    memory,
    anchor,
    readOwner: options.readOwner,
    models: options.models,
  });
  const tools = createExperienceTools({
    read,
    mutate,
    scopeIn,
    jobIn,
    namespace,
    memory,
    send: (...args) => send(...args),
    stop: (jobId) => stop(jobId),
    wait: (jobId) => wait(jobId),
  });
  const registry = createRegistry();
  const base = defineExtension({
    name: "gaia-experience",
    tasks: [anchor],
    tools: tools.tools,
  });
  registry.install(base);
  const shared = (options.extensions ?? []).map(trackedExtension);
  for (const extension of shared) registry.install(extension);
  async function prepareWorker(job: State["jobs"][number]) {
    const extensions = (
      (await options.extensionsForJob?.({
        profileId: id,
        scopeId: job.public.scopeId,
        jobId: job.public.id,
        conversationId: job.workerId,
      })) ?? []
    ).map(trackedExtension);
    for (const extension of extensions) registry.install(extension);
    try {
      await harness.commit(
        (tx) =>
          configure(tx, job.workerId, {
            extensions: [base, ...shared, ...extensions],
          }),
        ctx,
      );
    } catch (error) {
      for (const extension of extensions) registry.uninstall(extension);
      throw error;
    }
    return () => {
      for (const extension of extensions) registry.uninstall(extension);
    };
  }
  const { harness } = await openRecoveredHarness(
    await openNodeSqliteStorage(join(path, "pi.sqlite")),
    {
      models: options.models,
      env: options.env,
      registry,
      settings: { ...options.settings, retry: { maxRetries: 0 } },
    },
    ctx,
  );
  await harness.root(ctx);
  await harness.commit(async (tx) => {
    await tx.doc(ProfileDoc);
    await tx.doc(Images);
  }, ctx);
  // The old recovery policy deliberately aborts before provider access. Retain pending records without replay.
  await mutate((state) => {
    for (const job of state.jobs)
      if (!terminal(job.public))
        job.public.state = job.invocations.length
          ? {
              kind: "uncertain",
              interruptedAt: now(),
              partialText: job.partialText,
              message: "Server restarted during a tool invocation.",
              invocationIds: job.invocations,
            }
          : {
              kind: "interrupted",
              interruptedAt: now(),
              partialText: job.partialText,
            };
  });
  function liveModels() {
    return options.models.getModels("openai-codex").map((model) => ({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      capabilities: {
        images: model.input.includes("image"),
        thinkingLevels: effortLevels(model),
      },
    }));
  }
  async function addScope(
    state: State,
    tx: Tx,
    plan: z.infer<typeof ScopePlan>,
  ) {
    const conversation = await tx.createConversation({
      ownership: { kind: "ownerless" },
    });
    await configure(tx, conversation.id, {
      model: { provider: "openai-codex", modelId: "gpt-6.1-sol" },
      thinkingLevel: "high",
      instructions:
        "Passive scope context ledger. Never execute owner inputs here.",
    });
    const scope = {
      public: {
        ...plan,
        avatar:
          plan.avatar ??
          defaultAvatar([
            ...state.scopes.map((scope) => scope.public.avatar),
            ...(state.profile?.plan.scopes.map((scope) => scope.avatar) ?? []),
          ]),
        id: ScopeId.parse(randomUUID()),
        profileId: id,
        createdAt: now(),
      },
      conversationId: conversation.id,
      chat: {
        // Old GOOD requires this cache. Active reads and validation use Pi's live catalogue.
        models: liveModels(),
        modelId: "gpt-6.1-sol",
        thinkingLevel: "high",
        compaction: { kind: "idle" },
      },
      messages: [],
      ledger: [],
      revision: 0,
    };
    const parsed = Scope.parse(scope);
    state.scopes.push(parsed);
    return parsed.public;
  }
  async function joinChildren(jobId: string) {
    for (const child of (await read()).jobs.filter(
      (j) => j.public.parentId === jobId,
    ))
      await wait(child.public.id);
  }
  async function stopChildren(jobId: string) {
    for (const child of (await read()).jobs.filter(
      (j) => j.public.parentId === jobId,
    ))
      await stop(child.public.id);
  }
  async function wait(jobId: string) {
    const job = jobIn(await read(), jobId);
    await harness.waitForTask(job.taskId, ctx);
    return jobIn(await read(), jobId).public;
  }
  async function stop(jobId: string) {
    const job = jobIn(await read(), jobId);
    if (terminal(job.public)) return job.public;
    await mutate((state) => {
      const job = jobIn(state, jobId);
      if (!terminal(job.public))
        job.public.state = {
          kind: "stopping",
          requestedAt: now(),
          activity: [],
        };
    });
    controls.get(jobId)?.abort();
    await stopChildren(jobId);
    await harness.abortTask(job.taskId, ctx);
    await harness.waitForTask(job.taskId, ctx);
    await mutate((state) => {
      const job = jobIn(state, jobId);
      if (job.public.state.kind === "interrupted")
        job.public.state = {
          kind: "stopped",
          finishedAt: now(),
          partialText: job.partialText,
        };
    });
    return jobIn(await read(), jobId).public;
  }
  async function scopeState(scopeId: string) {
    const state = await read();
    const scope = scopeIn(state, scopeId);
    return ExperienceScopeState.parse({
      version: 1,
      profileId: id,
      scope: scope.public,
      revision: state.revision,
      messages: scope.messages,
      jobs: state.jobs
        .filter((j) => j.public.scopeId === scopeId)
        .map((j) => j.public),
      chat: { ...scope.chat, models: liveModels() },
      memoryRevision: memory(state, scopeId).at(-1)?.revision ?? 0,
    });
  }
  return {
    read,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async initialise(input: z.infer<typeof ExperienceCreate>) {
      return mutate((state) => {
        gate();
        if (state.profile) {
          if (state.createDigest !== digest(input))
            throw new HttpError(
              409,
              "That requestId belongs to another proposal.",
            );
          return state.profile;
        }
        state.createDigest = digest(input);
        state.profile = { id, kind: "proposed", revision: 1, plan: input.plan };
        return state.profile;
      });
    },
    async state() {
      const state = await read();
      if (!state.profile) throw new HttpError(404, "Unknown experience.");
      return {
        version: 1 as const,
        profile: state.profile,
        revision: state.revision,
        scopes: state.scopes.map((s) => s.public),
        jobs: state.jobs.map((j) => j.public),
        capabilities:
          typeof options.capabilities === "function"
            ? options.capabilities()
            : options.capabilities,
      };
    },
    async confirm(revision: number) {
      gate();
      await mutate(async (state, tx) => {
        gate();
        if (!state.profile || state.profile.revision !== revision)
          throw new HttpError(409, "Confirm the exact proposal revision.");
        if (state.profile.kind === "ready") return;
        for (const plan of state.profile.plan.scopes)
          await addScope(state, tx, plan);
        state.profile.kind = "ready";
      });
      return this.state();
    },
    async addScope(plan: z.infer<typeof ScopePlan>) {
      gate();
      return mutate(async (state, tx) => {
        gate();
        if (
          state.profile?.kind !== "ready" ||
          state.profile.plan.layout === "single"
        )
          throw new HttpError(409, "This profile cannot add a scope.");
        if (state.scopes.length >= 100)
          throw new HttpError(409, "Scope limit reached.");
        return addScope(state, tx, plan);
      });
    },
    scopeState,
    async send(scopeId: string, input: ExperienceSend) {
      return send(scopeId, input);
    },
    stop,
    wait,
    async retry(jobId: string, input: z.infer<typeof ExperienceRetry>) {
      const job = jobIn(await read(), jobId);
      if (!terminal(job.public))
        throw new HttpError(409, "Stop this attempt first.");
      if (job.public.state.kind === "uncertain" && !input.repeatUncertain)
        throw new HttpError(
          409,
          "Acknowledge repeatUncertain before repeating effects.",
        );
      if (
        job.public.state.kind !== "uncertain" &&
        job.public.dispatchedEffect &&
        !input.repeatEffects
      )
        throw new HttpError(
          409,
          "Confirm repeatEffects before running a started action again.",
        );
      return send(job.public.scopeId, {
        ...job.input,
        requestId: input.requestId,
      });
    },
    async configure(scopeId: string, input: ModelSelection) {
      return track(async () => {
        gate();
        const state = await read();
        const scope = scopeIn(state, scopeId);
        const models = liveModels();
        if (!models.some((model) => model.id === input.modelId))
          throw new HttpError(
            400,
            "This model is not available now. Choose another model.",
          );
        if (
          input.thinkingLevel !== undefined &&
          !models
            .find((model) => model.id === input.modelId)
            ?.capabilities?.thinkingLevels.includes(input.thinkingLevel)
        )
          throw new HttpError(400, "This model does not support that effort.");
        const conversation = await harness.conversation(
          scope.conversationId,
          ctx,
        );
        if (!conversation) throw new Error("Scope is missing.");
        const adapter = await conversationAdapter(
          conversation,
          harness,
          options.models,
          ctx,
        );
        await adapter.configure(input.modelId, input.thinkingLevel);
        await mutate((state) => {
          scopeIn(state, scopeId).chat = {
            ...adapter.controls(),
            compaction: scopeIn(state, scopeId).chat.compaction,
          };
        });
        return scopeState(scopeId);
      });
    },
    async compact(scopeId: string) {
      gate();
      if (compacting.has(scopeId))
        throw new HttpError(409, "This scope is compacting.");
      compacting.add(scopeId);
      const operation = (async () => {
        const state = await read();
        const scope = scopeIn(state, scopeId);
        if (
          state.jobs.some(
            (j) => j.public.scopeId === scopeId && !terminal(j.public),
          )
        )
          throw new HttpError(
            409,
            "Stop or finish this scope before compacting.",
          );
        const conversation = await harness.conversation(
          scope.conversationId,
          ctx,
        );
        if (!conversation) throw new Error("Scope is missing.");
        const adapter = await conversationAdapter(
          conversation,
          harness,
          options.models,
          ctx,
        );
        const kind = await adapter.compact(new AbortController().signal);
        const context = await conversation.context(ctx);
        await mutate((state) => {
          const scope = scopeIn(state, scopeId);
          scope.chat.compaction = { kind };
          scope.contextBase = JSON.stringify(context.messages);
          scope.compactedRevision = scope.revision;
        });
        return scopeState(scopeId);
      })();
      operations.add(operation);
      try {
        return await operation;
      } finally {
        operations.delete(operation);
        compacting.delete(scopeId);
      }
    },
    ...createImages({ getHarness: () => harness, gate, read, scopeIn, track }),
    async busy() {
      return {
        admissionOpen,
        jobs: (await read()).jobs.filter((j) => !terminal(j.public)).length,
        operations: operations.size,
      };
    },
    async quiesce() {
      admissionOpen = false;
      for (const job of (await read()).jobs.filter(
        (j) => !j.public.parentId && !terminal(j.public),
      ))
        await stop(job.public.id);
      await Promise.all(
        (await read()).jobs.map((job) => harness.waitForTask(job.taskId, ctx)),
      );
      await Promise.all([...operations]);
      return { admissionOpen: false as const, jobs: 0, operations: 0 };
    },
    async close() {
      await this.quiesce();
      await harness.close(ctx);
    },
  };
}
export type ProfileRuntime = Awaited<ReturnType<typeof openProfile>>;
