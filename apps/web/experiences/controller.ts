import type {
  Experience,
  ExperienceState,
  ExperienceScopeState,
  ExperienceJob,
} from "../../../packages/protocol/experiences.ts";
import { z } from "zod";
import {
  ExperienceId,
  ScopeId,
  ExperiencePlan,
} from "../../../packages/protocol/experiences.ts";
import type { ModelSelection } from "../../../packages/protocol/index.ts";
import {
  createExperienceClient,
  type ExperienceClient,
} from "../../../packages/sdk/experiences.ts";
import {
  browserDraftPersistence,
  createChatDraft,
  type DraftPersistence,
} from "../chat-draft";
import { createModelSelectionQueue } from "../model-selection";
import { appendImages, readImageFiles } from "../image-input";

export type Scope = { profileId: ExperienceId; scopeId: ScopeId };
const SelectionPreference = z.strictObject({
  version: z.literal(1),
  selected: z
    .strictObject({ profileId: ExperienceId, scopeId: ScopeId })
    .nullable(),
});
export interface SelectionPersistence {
  load(): unknown;
  save(value: z.infer<typeof SelectionPreference>): void;
}
export const experienceSelectionKey = "gaia:experience-selection:v1";
export function browserSelectionPersistence(): SelectionPersistence {
  return {
    load: () => {
      const value = localStorage.getItem(experienceSelectionKey);
      return value === null ? undefined : JSON.parse(value);
    },
    save: (value) =>
      localStorage.setItem(experienceSelectionKey, JSON.stringify(value)),
  };
}
export const experienceKey = (scope: Scope) =>
  `experience:${scope.profileId}:${scope.scopeId}`;
export function keyboardSend(event: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
}) {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229
  );
}
export function jobActive(job: ExperienceJob) {
  return ["queued", "running", "stopping"].includes(job.state.kind);
}
function createEntry(persistence: DraftPersistence, changed: () => void) {
  return {
    draft: createChatDraft(persistence, changed),
    state: undefined as ExperienceScopeState | undefined,
    error: "",
    offline: false,
    sending: false,
    reading: 0,
    composing: false,
    selection: undefined as ModelSelection | undefined,
    queue: undefined as
      ReturnType<typeof createModelSelectionQueue> | undefined,
    actions: new Set<string>(),
  };
}
export function createExperienceController(
  options: {
    client?: ExperienceClient;
    persistence?: (key: string) => DraftPersistence;
    selectionPersistence?: SelectionPersistence;
  } = {},
) {
  const client = options.client ?? createExperienceClient();
  const persistence = options.persistence ?? browserDraftPersistence;
  const selectionPersistence =
    options.selectionPersistence ?? browserSelectionPersistence();
  const entries = new Map<string, ReturnType<typeof createEntry>>();
  const listeners = new Set<() => void>();
  let version = 0;
  let paused = false;
  let generation = 0;
  let indexGeneration = 0;
  let proposalAttempt: { payload: string; requestId: string } | undefined;
  let streamGeneration = 0;
  let close: (() => void) | undefined;
  let selectionRequest: AbortController | undefined;
  const requests = new Set<AbortController>();
  const changed = () => {
    version++;
    listeners.forEach((listener) => listener());
  };
  const controller = {
    profiles: [] as Experience[],
    profile: undefined as ExperienceState | undefined,
    selected: undefined as Scope | undefined,
    error: "",
    loading: false,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version: () => version,
    entry(scope: Scope) {
      const key = experienceKey(scope);
      let entry = entries.get(key);
      if (!entry) {
        entry = createEntry(persistence(key), changed);
        entries.set(key, entry);
        void entry.draft.load();
      }
      return entry;
    },
    receive(scope: Scope, value: ExperienceScopeState) {
      if (
        paused ||
        value.profileId !== scope.profileId ||
        value.scope.profileId !== scope.profileId ||
        value.scope.id !== scope.scopeId
      )
        return;
      const entry = controller.entry(scope);
      entry.offline = false;
      if (!entry.state || value.revision > entry.state.revision)
        entry.state = value;
      changed();
    },
    async refresh() {
      const token = ++indexGeneration;
      await perform(async (signal) => {
        const value = await client.index(signal);
        if (!paused && token === indexGeneration) {
          controller.profiles = value.profiles;
          changed();
        }
      });
    },
    async restoreSelection() {
      if (paused || controller.profile || controller.selected) return false;
      try {
        const saved = SelectionPreference.safeParse(
          selectionPersistence.load(),
        );
        if (!saved.success || !saved.data.selected) return false;
        return await controller.selectProfile(
          saved.data.selected.profileId,
          saved.data.selected.scopeId,
        );
      } catch {
        return false;
      }
    },
    original() {
      controller.pause();
      paused = false;
      controller.profile = undefined;
      controller.selected = undefined;
      controller.loading = false;
      saveSelection(null);
      changed();
    },
    async selectProfile(id: ExperienceId, restoredScope?: ScopeId) {
      const token = ++generation;
      close?.();
      close = undefined;
      selectionRequest?.abort();
      const request = new AbortController();
      selectionRequest = request;
      controller.selected = undefined;
      controller.profile = undefined;
      controller.loading = true;
      controller.error = "";
      changed();
      try {
        const value = await client.state(id, request.signal);
        if (paused || token !== generation) return false;
        if (
          restoredScope &&
          (value.profile.kind !== "ready" ||
            !value.scopes.some(
              (scope) => scope.id === restoredScope && scope.profileId === id,
            ))
        ) {
          saveSelection(null);
          return false;
        }
        controller.profile = value;
        const first = restoredScope
          ? value.scopes.find((scope) => scope.id === restoredScope)
          : value.scopes[0];
        if (first && value.profile.kind === "ready")
          controller.select({ profileId: id, scopeId: first.id });
        return !!first && value.profile.kind === "ready";
      } catch (cause) {
        if (!paused && token === generation) {
          if (restoredScope) saveSelection(null);
          else controller.error = errorText(cause);
        }
        return false;
      } finally {
        if (!paused && token === generation) {
          controller.loading = false;
          changed();
        }
      }
    },
    select(scope: Scope) {
      if (
        controller.profile?.profile.kind !== "ready" ||
        controller.profile.profile.id !== scope.profileId ||
        !controller.profile.scopes.some(
          (item) =>
            item.id === scope.scopeId && item.profileId === scope.profileId,
        )
      )
        return;
      close?.();
      const stream = ++streamGeneration;
      controller.selected = scope;
      saveSelection(scope);
      const entry = controller.entry(scope);
      entry.composing = false;
      close = client.subscribe(
        scope.profileId,
        scope.scopeId,
        (value) => {
          if (stream === streamGeneration && controller.selected === scope)
            controller.receive(scope, value);
        },
        () => {
          if (
            !paused &&
            stream === streamGeneration &&
            controller.selected === scope
          ) {
            entry.offline = true;
            changed();
          }
        },
      );
      changed();
    },
    async propose(plan: ExperiencePlan) {
      const input = ExperiencePlan.parse(plan);
      const payload = JSON.stringify(input);
      const attempt =
        proposalAttempt?.payload === payload
          ? proposalAttempt
          : { payload, requestId: crypto.randomUUID() };
      proposalAttempt = attempt;
      const token = generation;
      return perform(async (signal) => {
        const proposal = await client.create(
          { requestId: attempt.requestId, plan: input },
          signal,
        );
        if (paused) return;
        if (proposalAttempt === attempt) proposalAttempt = undefined;
        indexGeneration++;
        controller.profiles = [
          ...controller.profiles.filter((item) => item.id !== proposal.id),
          proposal,
        ];
        if (token === generation) await controller.selectProfile(proposal.id);
        changed();
      });
    },
    async confirm(proposal: Experience) {
      const token = generation;
      return perform(async (signal) => {
        const value = await client.confirm(
          proposal.id,
          proposal.revision,
          signal,
        );
        if (
          paused ||
          token !== generation ||
          controller.profile?.profile.id !== proposal.id
        )
          return;
        controller.profile = value;
        indexGeneration++;
        controller.profiles = controller.profiles.map((item) =>
          item.id === proposal.id ? value.profile : item,
        );
        const first = value.scopes[0];
        if (first)
          controller.select({ profileId: proposal.id, scopeId: first.id });
      });
    },
    async createScope(label: string, purpose: string) {
      const profile = controller.profile;
      const token = generation;
      const selected = controller.selected;
      if (!profile || profile.profile.plan.layout === "single") return false;
      return perform(async (signal) => {
        const value = await client.createScope(
          profile.profile.id,
          { label, purpose },
          signal,
        );
        if (paused || token !== generation || controller.profile !== profile)
          return;
        controller.profile = { ...profile, scopes: [...profile.scopes, value] };
        if (controller.selected === selected)
          controller.select({
            profileId: profile.profile.id,
            scopeId: value.id,
          });
      });
    },
    compose(scope: Scope, composing: boolean) {
      controller.entry(scope).composing = composing;
      changed();
    },
    canSend(scope: Scope) {
      const entry = controller.entry(scope);
      const draft = entry.draft.read();
      const chat = entry.state?.chat;
      const images = chat?.models.find(
        (model) => model.id === (entry.selection?.modelId ?? chat.modelId),
      )?.capabilities?.images;
      return (
        !paused &&
        !!entry.state &&
        !entry.offline &&
        !entry.sending &&
        !entry.reading &&
        !entry.selection &&
        !entry.composing &&
        draft.kind === "ready" &&
        !!(draft.draft.text.trim() || draft.draft.images.length) &&
        (!draft.draft.images.length || !!images)
      );
    },
    async send(scope: Scope) {
      if (!controller.canSend(scope)) return;
      const entry = controller.entry(scope);
      const draft = entry.draft.read();
      if (draft.kind !== "ready") return;
      const snapshot = draft.draft;
      entry.sending = true;
      entry.error = "";
      changed();
      await perform(async (signal) => {
        const attachments = [];
        for (const image of snapshot.images)
          attachments.push(
            (await client.upload(scope.profileId, scope.scopeId, image, signal))
              .id,
          );
        await client.send(
          scope.profileId,
          scope.scopeId,
          { requestId: snapshot.requestId, text: snapshot.text, attachments },
          signal,
        );
        if (!signal.aborted) entry.draft.completeSend(snapshot.requestId);
      }, entry);
      entry.sending = false;
      changed();
    },
    async addImages(scope: Scope, files: File[]) {
      const entry = controller.entry(scope);
      entry.reading++;
      changed();
      try {
        const images = await readImageFiles(files);
        entry.draft.update((draft) => ({
          ...draft,
          images: appendImages(draft.images, images),
        }));
      } catch (cause) {
        entry.error = errorText(cause);
      } finally {
        entry.reading--;
        changed();
      }
    },
    selectModel(scope: Scope, selection: ModelSelection) {
      const entry = controller.entry(scope);
      entry.queue ??= createModelSelectionQueue(
        async (value) => {
          return perform(
            async (signal) =>
              receiveResponse(
                scope,
                signal,
                client.model(scope.profileId, scope.scopeId, value, signal),
              ),
            entry,
          );
        },
        (value) => {
          entry.selection = value;
          changed();
        },
      );
      entry.queue.select(selection);
    },
    async compact(scope: Scope) {
      await action(scope, "compact", async (signal) =>
        receiveResponse(
          scope,
          signal,
          client.compact(scope.profileId, scope.scopeId, signal),
        ),
      );
    },
    async stop(scope: Scope, job: ExperienceJob) {
      if (job.profileId !== scope.profileId || job.scopeId !== scope.scopeId)
        return;
      await action(scope, job.id, async (signal) => {
        await client.stop(scope.profileId, job.id, signal);
        await receiveResponse(
          scope,
          signal,
          client.scope(scope.profileId, scope.scopeId, signal),
        );
      });
    },
    async retry(scope: Scope, job: ExperienceJob, repeatUncertain = false) {
      if (
        job.profileId !== scope.profileId ||
        job.scopeId !== scope.scopeId ||
        (job.state.kind === "uncertain" && !repeatUncertain)
      )
        return;
      await action(scope, job.id, async (signal) => {
        await client.retry(
          scope.profileId,
          job.id,
          {
            requestId: crypto.randomUUID(),
            ...(repeatUncertain ? { repeatUncertain: true } : {}),
          },
          signal,
        );
        await receiveResponse(
          scope,
          signal,
          client.scope(scope.profileId, scope.scopeId, signal),
        );
      });
    },
    prepareReload: () =>
      [...entries.values()].every(
        (entry) =>
          !entry.sending &&
          !entry.reading &&
          !entry.composing &&
          !entry.selection &&
          entry.draft.prepareReload(),
      ),
    resume() {
      paused = false;
      if (controller.selected) controller.select(controller.selected);
    },
    pause() {
      paused = true;
      generation++;
      indexGeneration++;
      streamGeneration++;
      close?.();
      close = undefined;
      selectionRequest?.abort();
      requests.forEach((request) => request.abort());
      entries.forEach((entry) => {
        entry.queue?.dispose();
        entry.queue = undefined;
        entry.selection = undefined;
      });
    },
    client,
  };
  async function receiveResponse(
    scope: Scope,
    signal: AbortSignal,
    response: Promise<ExperienceScopeState>,
  ) {
    const value = await response;
    if (!signal.aborted) controller.receive(scope, value);
  }
  function saveSelection(selected: Scope | null) {
    try {
      selectionPersistence.save({
        version: 1,
        selected: selected
          ? { profileId: selected.profileId, scopeId: selected.scopeId }
          : null,
      });
    } catch {
      // Navigation still works when browser storage is unavailable.
    }
  }
  async function perform(
    run: (signal: AbortSignal) => Promise<unknown>,
    entry?: ReturnType<typeof createEntry>,
  ) {
    if (paused) return false;
    const request = new AbortController();
    requests.add(request);
    if (entry) entry.error = "";
    else controller.error = "";
    try {
      await run(request.signal);
      return true;
    } catch (cause) {
      if (!paused && !request.signal.aborted) {
        if (entry) entry.error = errorText(cause);
        else controller.error = errorText(cause);
      }
      return false;
    } finally {
      requests.delete(request);
      changed();
    }
  }
  async function action(
    scope: Scope,
    key: string,
    run: (signal: AbortSignal) => Promise<unknown>,
  ) {
    const entry = controller.entry(scope);
    if (entry.actions.has(key)) return;
    entry.actions.add(key);
    changed();
    await perform(run, entry);
    entry.actions.delete(key);
    changed();
  }
  return controller;
}
const errorText = (cause: unknown) =>
  cause instanceof Error
    ? cause.message
    : "Gaia could not complete that request. Try again.";
export type ExperienceController = ReturnType<
  typeof createExperienceController
>;
