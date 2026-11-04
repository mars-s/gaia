import { z } from "zod";
import {
  ImageUpload,
  imageLimits,
} from "../../packages/protocol/attachments.ts";

export const ChatDraft = z.strictObject({
  requestId: z.string().uuid(),
  text: z.string().max(32000),
  images: z.array(ImageUpload).max(imageLimits.count),
});
const StoredChatDraft = ChatDraft.refine(
  (draft) =>
    draft.images.every((image) => {
      try {
        return btoa(atob(image.data)) === image.data;
      } catch {
        return false;
      }
    }),
  "Saved image data is invalid.",
);
export type ChatDraft = z.infer<typeof ChatDraft>;
export type DraftState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      draft: ChatDraft;
      durability: "saving" | "saved" | "memory";
    };
export interface DraftPersistence {
  load(): Promise<unknown>;
  save(draft: ChatDraft): Promise<void>;
}
const empty = (): ChatDraft => ({
  requestId: crypto.randomUUID(),
  text: "",
  images: [],
});

export function createChatDraft(
  persistence: DraftPersistence,
  changed: (state: DraftState) => void,
  legacy = "",
) {
  let state: DraftState = { kind: "loading" };
  let loading: Promise<void> | undefined;
  let writing = false;
  let queued: ChatDraft | undefined;
  const publish = (value: DraftState) => {
    state = value;
    changed(value);
  };
  async function flush() {
    if (writing) return;
    writing = true;
    while (queued) {
      const draft = queued;
      queued = undefined;
      let durability: "saved" | "memory" = "saved";
      try {
        await persistence.save(draft);
      } catch {
        durability = "memory";
      }
      if (state.kind === "ready" && state.draft === draft)
        publish({ ...state, durability });
    }
    writing = false;
  }
  function persist(draft: ChatDraft) {
    publish({ kind: "ready", draft, durability: "saving" });
    queued = draft;
    void flush();
  }
  return {
    read: () => state,
    load() {
      if (loading) return loading;
      if (state.kind === "ready") return Promise.resolve();
      publish({ kind: "loading" });
      loading = persistence
        .load()
        .then((value) => {
          const draft =
            value === undefined
              ? { ...empty(), text: legacy }
              : StoredChatDraft.parse(value);
          persist(draft);
        })
        .catch(() => {
          publish({
            kind: "error",
            message:
              "Your saved draft could not be loaded. Retry to keep it intact.",
          });
        })
        .finally(() => {
          loading = undefined;
        });
      return loading;
    },
    update(change: (draft: ChatDraft) => Pick<ChatDraft, "text" | "images">) {
      if (state.kind !== "ready") return;
      const draft = state.draft;
      const next = change(draft);
      if (
        next.text === draft.text &&
        next.images.length === draft.images.length &&
        next.images.every((image, index) => {
          const old = draft.images[index];
          return (
            old &&
            image.id === old.id &&
            image.name === old.name &&
            image.mimeType === old.mimeType &&
            image.data === old.data
          );
        })
      )
        return;
      persist(
        ChatDraft.parse({
          ...next,
          requestId: crypto.randomUUID(),
        }),
      );
    },
    completeSend(requestId: string) {
      if (state.kind === "ready" && state.draft.requestId === requestId)
        persist(empty());
    },
    retrySave() {
      if (state.kind === "ready") persist(state.draft);
    },
    prepareReload() {
      return state.kind === "ready" && state.durability === "saved";
    },
  };
}

function draftTransaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction("drafts", mode);
    const timer = setTimeout(() => transaction.abort(), 5000);
    const request = operation(transaction.objectStore("drafts"));
    transaction.oncomplete = () => {
      clearTimeout(timer);
      resolve(request.result);
    };
    const failed = () => {
      clearTimeout(timer);
      reject(new Error("Draft storage transaction failed."));
    };
    transaction.onerror = failed;
    transaction.onabort = failed;
  });
}

export function browserDraftPersistence(): DraftPersistence {
  let connection: Promise<IDBDatabase> | undefined;
  function database() {
    connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("gaia-chat-drafts", 1);
      let expired = false;
      const fail = () => {
        expired = true;
        clearTimeout(timer);
        reject(new Error("Draft storage unavailable."));
      };
      const timer = setTimeout(fail, 5000);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("drafts");
      request.onerror = fail;
      request.onblocked = fail;
      request.onsuccess = () => {
        clearTimeout(timer);
        if (expired) {
          request.result.close();
          return;
        }
        request.result.onversionchange = () => {
          request.result.close();
          connection = undefined;
        };
        resolve(request.result);
      };
    }).catch((error) => {
      connection = undefined;
      throw error;
    });
    return connection;
  }
  return {
    async load() {
      return draftTransaction(await database(), "readonly", (store) =>
        store.get("local"),
      );
    },
    async save(draft) {
      await draftTransaction(await database(), "readwrite", (store) =>
        store.put(draft, "local"),
      );
    },
  };
}
