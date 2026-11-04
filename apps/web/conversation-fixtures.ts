import type { Snapshot, Thread } from "../../packages/protocol/index.ts";
import { AreaId, type WorkspaceState } from "../../packages/sdk/workspace.ts";
import type { AreaSnapshot } from "../../packages/sdk/areas.ts";
import type { DraftPersistence, ChatDraft } from "./chat-draft.ts";

export const firstArea = AreaId.parse("11111111-1111-4111-8111-111111111111");
export const secondArea = AreaId.parse("22222222-2222-4222-8222-222222222222");
export const proposalId = "33333333-3333-4333-8333-333333333333";
export const emptyThread = (): Thread => ({
  version: 1,
  id: "local",
  messages: [],
  run: { kind: "idle" },
});
export const homeSnapshot = (): Snapshot => ({
  connection: { kind: "connected", model: "gpt-6.1-sol" },
  thread: emptyThread(),
  chat: {
    modelId: "home-model",
    thinkingLevel: "high",
    compaction: { kind: "idle" },
    models: [
      {
        id: "home-model",
        name: "Home model",
        contextWindow: 10000,
        capabilities: { images: true, thinkingLevels: ["low", "high"] },
      },
    ],
  },
});
export function areaSnapshot(areaId = firstArea): AreaSnapshot {
  return {
    areaId,
    thread: emptyThread(),
    chat: {
      modelId: "area-model",
      thinkingLevel: "low",
      compaction: { kind: "idle" },
      models: [
        {
          id: "area-model",
          name: "Area model",
          contextWindow: 5000,
          capabilities: { images: false, thinkingLevels: ["low", "high"] },
        },
      ],
    },
  };
}
export const multiWorkspace = (): Extract<
  WorkspaceState,
  { kind: "confirmed" }
> => ({
  kind: "confirmed",
  proposal: {
    proposalId,
    revision: 7,
    workspace: {
      kind: "multi",
      areas: [
        { areaId: firstArea, label: "Study", purpose: "Review coursework" },
        {
          areaId: secondArea,
          label: "Garden",
          purpose: "Plan seasonal planting",
        },
      ],
    },
    sharedPreferences: ["Use Australian English"],
  },
});
export function memoryDrafts() {
  const values = new Map<string, ChatDraft>();
  const store = (key: string): DraftPersistence => ({
    async load() {
      return values.get(key);
    },
    async save(value) {
      values.set(key, structuredClone(value));
    },
  });
  return { values, store };
}
export function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (cause: unknown) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export async function settle() {
  for (let n = 0; n < 25; n++) await Promise.resolve();
}
