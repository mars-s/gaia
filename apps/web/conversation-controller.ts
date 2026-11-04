import type {
  Chat,
  ModelSelection,
  Snapshot,
  Thread,
} from "../../packages/protocol/index.ts";
import {
  ModelSelection as SelectionSchema,
  Send,
} from "../../packages/protocol/index.ts";
import { command } from "../../packages/sdk/index.ts";
import { uploadImage } from "../../packages/sdk/images.ts";
import {
  areaCommand,
  confirmWorkspace,
  readArea,
  readWorkspace,
  uploadAreaImage,
} from "../../packages/sdk/workspace-client.ts";
import type { WorkspaceConfirmation } from "../../packages/sdk/workspace.ts";
import {
  browserDraftPersistence,
  createChatDraft,
  type DraftPersistence,
  type DraftState,
} from "./chat-draft";
import { readImageFiles, appendImages } from "./image-input";
import { createModelSelectionQueue } from "./model-selection";
import {
  createWorkspaceController,
  homeScope,
  scopeKey,
  type ConversationScope,
} from "./workspace-controller";

type Action = Parameters<typeof areaCommand>[1];
export type SendProgress =
  | { kind: "idle" }
  | { kind: "uploading"; completed: number; total: number }
  | { kind: "sending" };
export type ComposerSession = {
  scope: ConversationScope;
  draft: ReturnType<typeof createChatDraft>;
  draftState: DraftState;
  queue: ReturnType<typeof createModelSelectionQueue>;
  selection?: ModelSelection;
  error: string;
  reads: number;
  composing: boolean;
  progress: SendProgress;
  upload?: AbortController;
};
const defaultApi = {
  command,
  areaCommand,
  uploadImage,
  uploadAreaImage,
  confirmWorkspace,
  readArea,
  readWorkspace,
  readImageFiles,
};

export function stopScope(
  home: Snapshot | undefined,
  scope: ConversationScope,
  thread?: Thread,
): ConversationScope | undefined {
  if (thread?.run.kind !== "running" || thread.run.operation === "model")
    return;
  if (home?.thread.run.kind === "running") return homeScope;
  return scope.kind === "area" ? scope : undefined;
}

export function createConversationController({
  api = defaultApi,
  persistence = (scope: ConversationScope) =>
    browserDraftPersistence(scopeKey(scope)),
  legacy = "",
  migrated = () => {},
}: {
  api?: typeof defaultApi;
  persistence?: (scope: ConversationScope) => DraftPersistence;
  legacy?: string;
  migrated?: () => void;
} = {}) {
  let version = 0;
  const listeners = new Set<() => void>();
  const sessions = new Map<string, ComposerSession>();
  let selected: ConversationScope = homeScope;
  let home: Snapshot | undefined;
  let homeVersion = 0;
  let offline = true;
  let pending: { scope: ConversationScope; action: string } | undefined;
  const changed = () => {
    version++;
    for (const notify of listeners) notify();
  };
  const workspace = createWorkspaceController(() => {
    for (const entry of sessions.values()) {
      if (entry.scope.kind === "area")
        acknowledge(entry.scope, view(entry.scope)?.thread);
    }
    changed();
  }, api);

  function view(
    scope: ConversationScope,
  ): { thread: Thread; chat?: Chat } | undefined {
    return scope.kind === "home"
      ? home
      : workspace.areas.get(scope.areaId)?.snapshot;
  }
  function session(scope: ConversationScope) {
    const key = scopeKey(scope);
    const existing = sessions.get(key);
    if (existing) return existing;
    const entry: ComposerSession = {
      scope,
      draftState: { kind: "loading" },
      error: "",
      reads: 0,
      composing: false,
      progress: { kind: "idle" },
      draft: createChatDraft(
        persistence(scope),
        (state) => {
          entry.draftState = state;
          if (
            scope.kind === "home" &&
            state.kind === "ready" &&
            state.durability === "saved"
          )
            migrated();
          changed();
        },
        scope.kind === "home" ? legacy : "",
      ),
      queue: createModelSelectionQueue(
        (value) => act(scope, "model", value),
        (value) => {
          entry.selection = value;
          changed();
        },
      ),
    };
    sessions.set(key, entry);
    return entry;
  }
  function acknowledge(scope: ConversationScope, thread?: Thread) {
    const entry = sessions.get(scopeKey(scope));
    const draft = entry?.draft.read();
    if (
      entry &&
      draft?.kind === "ready" &&
      thread?.messages.some(
        (message) =>
          message.role === "user" && message.id === draft.draft.requestId,
      )
    )
      entry.draft.completeSend(draft.draft.requestId);
  }
  function receiveHome(value: Snapshot) {
    const previous = home;
    homeVersion++;
    home = value;
    offline = false;
    workspace.setConnected(
      value.connection.kind === "connected" && !safeMode(),
    );
    if (safeMode() && selected.kind === "area") {
      selected = homeScope;
      workspace.select(homeScope);
      void session(homeScope).draft.load();
    }
    acknowledge(homeScope, value.thread);
    changed();
    if (
      previous &&
      value.thread.run.kind !== "running" &&
      (previous.thread.run.kind === "running" ||
        previous.thread.messages.at(-1)?.id !==
          value.thread.messages.at(-1)?.id ||
        previous.thread.messages.at(-1)?.text !==
          value.thread.messages.at(-1)?.text)
    ) {
      void workspace.refresh();
      if (selected.kind === "area") void workspace.refreshArea(selected.areaId);
    }
  }
  function busyScope(): ConversationScope | undefined {
    if (home?.thread.run.kind === "running") return homeScope;
    if (safeMode()) return;
    const areaId = workspace.busy();
    return areaId ? { kind: "area", areaId } : undefined;
  }
  function selectionPending() {
    return [...sessions.values()].some(
      (entry) =>
        entry.selection && (!safeMode() || entry.scope.kind === "home"),
    );
  }
  function safeMode() {
    return home?.runtime?.mode === "safe";
  }
  function available(scope: ConversationScope) {
    if (offline || home?.connection.kind !== "connected") return false;
    if (safeMode()) return scope.kind === "home";
    return (
      workspace.ready() &&
      (scope.kind === "home" ||
        workspace.areas.get(scope.areaId)?.status === "ready")
    );
  }
  async function perform(
    scope: ConversationScope,
    action: string,
    work: () => Promise<void>,
    mode: "chat" | "stop" | "home" | "model" = "chat",
  ) {
    if (pending || offline) return false;
    if (mode === "chat" || mode === "model") {
      if (
        !available(scope) ||
        busyScope() ||
        (mode !== "model" && selectionPending())
      )
        return false;
    } else if (mode === "home" && (busyScope() || selectionPending()))
      return false;
    const entry = session(scope);
    pending = { scope, action };
    entry.error = "";
    changed();
    try {
      await work();
      return true;
    } catch (cause) {
      entry.error =
        cause instanceof Error
          ? cause.message
          : "Gaia could not complete that request. Your draft is here.";
      return false;
    } finally {
      pending = undefined;
      changed();
    }
  }
  async function requestHome(
    path: string,
    input: unknown = {},
    signal?: AbortSignal,
  ) {
    const revision = homeVersion;
    const result = await api.command(path, input, signal);
    acknowledge(homeScope, result.thread);
    if (homeVersion === revision) receiveHome(result);
  }
  async function request(
    scope: ConversationScope,
    action: Action,
    input: unknown = {},
    signal?: AbortSignal,
  ) {
    if (scope.kind === "home") return requestHome(action, input, signal);
    const finish = workspace.beginCommand(scope.areaId);
    try {
      const result = await api.areaCommand(scope.areaId, action, input, signal);
      if (result.areaId !== scope.areaId)
        throw new Error("The response did not match this area.");
      await finish(result);
      acknowledge(scope, result.thread);
    } catch (cause) {
      await finish();
      throw cause;
    }
  }
  function act(scope: ConversationScope, action: Action, input: unknown = {}) {
    return perform(
      scope,
      action,
      () =>
        request(
          scope,
          action,
          action === "model"
            ? SelectionSchema.parse(input)
            : action === "messages"
              ? Send.parse(input)
              : {},
        ),
      action === "model" ? "model" : "chat",
    );
  }
  function supportsImages(scope: ConversationScope) {
    const chat = view(scope)?.chat;
    return Boolean(
      chat?.models.find((model) => model.id === chat.modelId)?.capabilities
        ?.images,
    );
  }
  function canSend(scope: ConversationScope) {
    const entry = session(scope);
    const draft = entry.draft.read();
    return Boolean(
      available(scope) &&
      !pending &&
      !busyScope() &&
      !selectionPending() &&
      !entry.reads &&
      !entry.composing &&
      draft.kind === "ready" &&
      (draft.draft.text.trim() || draft.draft.images.length) &&
      (!draft.draft.images.length || supportsImages(scope)),
    );
  }
  return {
    workspace,
    session,
    view,
    receiveHome,
    busyScope,
    supportsImages,
    canSend,
    available,
    get safeMode() {
      return safeMode();
    },
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    version: () => version,
    get home() {
      return home;
    },
    get offline() {
      return offline;
    },
    get selected() {
      return selected;
    },
    get pending() {
      return pending;
    },
    get selectionPending() {
      return selectionPending();
    },
    select(scope: ConversationScope) {
      if (safeMode() && scope.kind === "area") return;
      if (
        scope.kind === "area" &&
        !workspace.areaList().some((area) => area.areaId === scope.areaId)
      )
        return;
      selected = scope;
      void session(scope)
        .draft.load()
        .then(() => acknowledge(scope, view(scope)?.thread));
      workspace.select(scope);
      changed();
    },
    setOffline() {
      homeVersion++;
      offline = true;
      workspace.setConnected(false);
      changed();
    },
    pause() {
      workspace.setConnected(false);
    },
    resume() {
      workspace.setConnected(
        !offline && home?.connection.kind === "connected" && !safeMode(),
      );
      const scope = selected;
      void session(scope)
        .draft.load()
        .then(() => acknowledge(scope, view(scope)?.thread));
    },
    prepareReload() {
      const configuring = (thread?: Thread) =>
        thread?.run.kind === "running" && thread.run.operation === "model";
      return (
        !pending &&
        !configuring(home?.thread) &&
        (safeMode() ||
          ![...workspace.areas.values()].some((area) =>
            configuring(area.snapshot?.thread),
          )) &&
        [...sessions.values()].every(
          (entry) =>
            !entry.reads &&
            !entry.composing &&
            !entry.selection &&
            entry.draft.prepareReload(),
        )
      );
    },
    compose(scope: ConversationScope, value: boolean) {
      session(scope).composing = value;
      changed();
    },
    modelDisabled(scope: ConversationScope) {
      const ownModel =
        session(scope).selection &&
        (!pending ||
          (pending.action === "model" &&
            scopeKey(pending.scope) === scopeKey(scope)));
      return (
        !available(scope) ||
        (!ownModel && Boolean(pending || busyScope() || selectionPending()))
      );
    },
    act,
    homeAction(path: string, input: unknown = {}) {
      const skip = path === "profile/skip" && busyScope()?.kind === "home";
      return perform(
        homeScope,
        path,
        () => requestHome(path, input),
        skip ? "stop" : "home",
      );
    },
    stop(scope: ConversationScope) {
      const target = stopScope(home, scope, view(scope)?.thread);
      if (!target || selectionPending()) return Promise.resolve(false);
      return perform(target, "stop", () => request(target, "stop"), "stop");
    },
    async confirm(input: WorkspaceConfirmation) {
      if (safeMode()) return false;
      const proposal = workspace.state;
      if (
        proposal?.kind !== "proposed" ||
        proposal.proposal.proposalId !== input.proposalId ||
        proposal.proposal.revision !== input.revision
      ) {
        session(homeScope).error =
          "That setup has changed. Review the latest proposal.";
        changed();
        await workspace.refresh();
        return false;
      }
      const ok = await perform(homeScope, "workspace/confirm", async () => {
        await api.confirmWorkspace(input);
      });
      await workspace.refresh();
      return ok;
    },
    async send(scope: ConversationScope) {
      if (!canSend(scope)) return false;
      const entry = session(scope);
      const state = entry.draft.read();
      if (state.kind !== "ready") return false;
      const sent = state.draft;
      return perform(scope, "messages", async () => {
        const controller = new AbortController();
        entry.upload = controller;
        try {
          for (let n = 0; n < sent.images.length; n++) {
            entry.progress = {
              kind: "uploading",
              completed: n,
              total: sent.images.length,
            };
            changed();
            if (scope.kind === "home")
              await api.uploadImage(sent.images[n], controller.signal);
            else
              await api.uploadAreaImage(
                scope.areaId,
                sent.images[n],
                controller.signal,
              );
          }
          controller.signal.throwIfAborted();
          entry.progress = { kind: "sending" };
          changed();
          await request(
            scope,
            "messages",
            Send.parse({
              text: sent.text,
              requestId: sent.requestId,
              ...(sent.images.length
                ? { attachments: sent.images.map((image) => image.id) }
                : {}),
            }),
            controller.signal,
          );
          entry.draft.completeSend(sent.requestId);
        } finally {
          if (scope.kind === "area" && entry.progress.kind === "uploading")
            void workspace.refreshArea(scope.areaId);
          entry.upload = undefined;
          entry.progress = { kind: "idle" };
          changed();
        }
      });
    },
    async addImages(scope: ConversationScope, files: File[]) {
      if (!files.length) return;
      const entry = session(scope);
      if (entry.draft.read().kind !== "ready" || !supportsImages(scope)) {
        entry.error =
          "Load your draft and choose an image-capable model before attaching images.";
        changed();
        return;
      }
      entry.reads++;
      entry.error = "";
      changed();
      try {
        const added = await api.readImageFiles(files);
        entry.draft.update((draft) => ({
          ...draft,
          images: appendImages(draft.images, added),
        }));
      } catch (cause) {
        entry.error =
          cause instanceof Error
            ? cause.message
            : "Images could not be read. Try again.";
      } finally {
        entry.reads--;
        changed();
      }
    },
  };
}
export type ConversationController = ReturnType<
  typeof createConversationController
>;
