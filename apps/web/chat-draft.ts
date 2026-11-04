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
  operation: (transaction: IDBTransaction) => () => T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(["drafts", "images"], mode);
    const timer = setTimeout(() => transaction.abort(), 30000);
    const result = operation(transaction);
    transaction.oncomplete = () => {
      clearTimeout(timer);
      resolve(result());
    };
    const failed = () => {
      clearTimeout(timer);
      reject(new Error("Draft storage transaction failed."));
    };
    transaction.onerror = failed;
    transaction.onabort = failed;
  });
}

const DraftReferences = ChatDraft.omit({ images: true }).extend({
  version: z.union([z.literal(2), z.literal(3)]),
  imageIds: z.array(z.string().uuid()).max(imageLimits.count),
});

export function browserDraftPersistence(key = "local"): DraftPersistence {
  let connection: Promise<IDBDatabase> | undefined;
  function database() {
    connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("gaia-chat-drafts", 2);
      let expired = false;
      const fail = () => {
        expired = true;
        clearTimeout(timer);
        reject(new Error("Draft storage unavailable."));
      };
      const timer = setTimeout(fail, 5000);
      request.onupgradeneeded = () => {
        for (const store of ["drafts", "images"])
          if (!request.result.objectStoreNames.contains(store))
            request.result.createObjectStore(store);
      };
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
      return draftTransaction(await database(), "readonly", (transaction) => {
        let value: unknown;
        const request = transaction.objectStore("drafts").get(key);
        request.onsuccess = () => {
          value = request.result;
          const references = DraftReferences.safeParse(value);
          if (!references.success) return;
          const { imageIds, requestId, text } = references.data;
          const images: ImageUpload[] = [];
          value = { requestId, text, images };
          imageIds.forEach((id, index) => {
            const image = transaction
              .objectStore("images")
              .get(
                references.data.version === 2 && key === "local"
                  ? id
                  : `${key}:${id}`,
              );
            image.onsuccess = () => {
              const parsed = ImageUpload.safeParse(image.result);
              if (!parsed.success || parsed.data.id !== id) transaction.abort();
              else images[index] = parsed.data;
            };
          });
        };
        return () => value;
      });
    },
    async save(draft) {
      await draftTransaction(await database(), "readwrite", (transaction) => {
        const images = transaction.objectStore("images");
        for (const image of draft.images) {
          const imageKey = `${key}:${image.id}`;
          const existing = images.getKey(imageKey);
          existing.onsuccess = () => {
            if (existing.result === undefined) images.add(image, imageKey);
          };
        }
        transaction.objectStore("drafts").put(
          {
            version: 3,
            requestId: draft.requestId,
            text: draft.text,
            imageIds: draft.images.map((image) => image.id),
          },
          key,
        );
        return () => undefined;
      });
    },
  };
}
