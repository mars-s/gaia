import type { AreaSnapshot } from "../../packages/sdk/areas.ts";
import type { AreaId, WorkspaceState } from "../../packages/sdk/workspace.ts";
import {
  readArea,
  readWorkspace,
} from "../../packages/sdk/workspace-client.ts";

export type ConversationScope =
  { kind: "home" } | { kind: "area"; areaId: AreaId };
export const homeScope = { kind: "home" } satisfies ConversationScope;
export const scopeKey = (scope: ConversationScope) =>
  scope.kind === "home" ? "local" : `area:${scope.areaId}`;
export type AreaView = {
  snapshot?: AreaSnapshot;
  status: "loading" | "ready" | "reconnecting";
};

export function createWorkspaceController(
  changed: () => void,
  api = { readArea, readWorkspace },
) {
  let state: WorkspaceState | undefined;
  let error = "";
  let connected = false;
  let selected: AreaId | undefined;
  let generation = 0;
  let sweepVersion = 0;
  let workspaceRead: AbortController | undefined;
  let sweepTimer: ReturnType<typeof setTimeout> | undefined;
  const areas = new Map<AreaId, AreaView>();
  const requests = new Map<AreaId, AbortController>();
  const timers = new Map<AreaId, ReturnType<typeof setTimeout>>();
  const mutating = new Set<AreaId>();

  function areaList() {
    return state?.kind === "confirmed" &&
      state.proposal.workspace.kind === "multi"
      ? state.proposal.workspace.areas
      : [];
  }
  function cancelArea(id: AreaId) {
    requests.get(id)?.abort();
    requests.delete(id);
    clearTimeout(timers.get(id));
    timers.delete(id);
  }
  function schedule(id: AreaId) {
    clearTimeout(timers.get(id));
    if (!connected || mutating.has(id)) return;
    const view = areas.get(id);
    if (selected !== id && view?.snapshot?.thread.run.kind !== "running")
      return;
    timers.set(
      id,
      setTimeout(
        () => void refreshArea(id),
        view?.status === "reconnecting"
          ? 3000
          : view?.snapshot?.thread.run.kind === "running"
            ? 1000
            : 5000,
      ),
    );
  }
  async function refreshArea(id: AreaId) {
    if (!connected || mutating.has(id)) return;
    cancelArea(id);
    const controller = new AbortController();
    requests.set(id, controller);
    if (!areas.has(id)) areas.set(id, { status: "loading" });
    try {
      const snapshot = await api.readArea(id, controller.signal);
      if (snapshot.areaId !== id)
        throw new Error("The area response did not match this conversation.");
      if (requests.get(id) !== controller || controller.signal.aborted) return;
      areas.set(id, { snapshot, status: "ready" });
    } catch {
      if (requests.get(id) !== controller || controller.signal.aborted) return;
      areas.set(id, { ...areas.get(id), status: "reconnecting" });
    } finally {
      if (requests.get(id) === controller) {
        requests.delete(id);
        changed();
        schedule(id);
      }
    }
  }
  async function sweep() {
    clearTimeout(sweepTimer);
    const current = generation;
    const revision = ++sweepVersion;
    for (const area of areaList()) {
      if (!connected || current !== generation || revision !== sweepVersion)
        return;
      if (
        area.areaId !== selected &&
        areas.get(area.areaId)?.snapshot?.thread.run.kind !== "running"
      )
        await refreshArea(area.areaId);
    }
    if (connected && current === generation && revision === sweepVersion)
      sweepTimer = setTimeout(() => void sweep(), 15000);
  }
  async function refresh() {
    if (!connected) return;
    workspaceRead?.abort();
    const controller = new AbortController();
    workspaceRead = controller;
    try {
      const value = await api.readWorkspace(controller.signal);
      if (workspaceRead !== controller || controller.signal.aborted) return;
      state = value;
      error = "";
      changed();
      if (selected) void refreshArea(selected);
      if (areaList().length) void sweep();
    } catch (cause) {
      if (workspaceRead !== controller || controller.signal.aborted) return;
      error =
        cause instanceof Error
          ? cause.message
          : "Workspace could not be loaded.";
      changed();
    }
  }
  return {
    get state() {
      return state;
    },
    get error() {
      return error;
    },
    get areas() {
      return areas;
    },
    areaList,
    refresh,
    refreshArea,
    ready() {
      return (
        Boolean(state) &&
        !error &&
        areaList().every((area) => {
          const status = areas.get(area.areaId)?.status;
          return status !== undefined && status !== "loading";
        })
      );
    },
    busy() {
      return areaList().find(
        (area) =>
          areas.get(area.areaId)?.status === "ready" &&
          areas.get(area.areaId)?.snapshot?.thread.run.kind === "running",
      )?.areaId;
    },
    select(scope: ConversationScope) {
      const previous = selected;
      selected = scope.kind === "area" ? scope.areaId : undefined;
      if (
        previous &&
        previous !== selected &&
        areas.get(previous)?.snapshot?.thread.run.kind !== "running"
      )
        cancelArea(previous);
      if (selected) void refreshArea(selected);
    },
    setConnected(value: boolean) {
      if (connected === value) return;
      connected = value;
      generation++;
      if (value) {
        void refresh();
        if (selected) void refreshArea(selected);
        for (const [id, view] of areas)
          if (id !== selected && view.snapshot?.thread.run.kind === "running")
            void refreshArea(id);
      } else {
        workspaceRead?.abort();
        workspaceRead = undefined;
        clearTimeout(sweepTimer);
        for (const id of requests.keys()) cancelArea(id);
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
      }
    },
    beginCommand(id: AreaId) {
      cancelArea(id);
      mutating.add(id);
      return (snapshot?: AreaSnapshot) => {
        mutating.delete(id);
        if (snapshot?.areaId === id) {
          areas.set(id, { snapshot, status: "ready" });
          changed();
        }
        return refreshArea(id);
      };
    },
  };
}
