import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createChatDraft,
  type ChatDraft,
  type DraftPersistence,
} from "./chat-draft.ts";
import { appendImages, readImageFiles } from "./image-input.ts";
import { createReleaseObserver } from "./renderer-release.ts";
import { imageLimits } from "../../packages/protocol/attachments.ts";

function memory(): DraftPersistence & { value: unknown } {
  return {
    value: undefined,
    async load() {
      return this.value;
    },
    async save(value) {
      this.value = structuredClone(value);
    },
  };
}
async function saved(draft: ReturnType<typeof createChatDraft>) {
  for (let n = 0; n < 50 && !draft.prepareReload(); n++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert(draft.prepareReload());
}
function current(draft: ReturnType<typeof createChatDraft>): ChatDraft {
  const state = draft.read();
  assert.equal(state.kind, "ready");
  if (state.kind !== "ready") throw new Error("Draft expected.");
  return state.draft;
}

test("text and actual image drafts reload with the same admission identity after failure and restart", async () => {
  const persistence = memory();
  const draft = createChatDraft(persistence, () => {}, "Legacy unsent text");
  await draft.load();
  await saved(draft);
  assert.equal(current(draft).text, "Legacy unsent text");
  const images = await readImageFiles([
    new File(["image bytes"], "test.png", { type: "image/png" }),
  ]);
  draft.update((value) => ({ ...value, images }));
  await saved(draft);
  const sent = current(draft);
  draft.update((value) => ({
    ...value,
    images: appendImages(value.images, images),
  }));
  assert.equal(
    current(draft).requestId,
    sent.requestId,
    "Duplicate files must not change admission identity.",
  );
  const reopened = createChatDraft(persistence, () => {});
  await reopened.load();
  await saved(reopened);
  assert.deepEqual(current(reopened), sent);
  assert.equal(atob(current(reopened).images[0]?.data ?? ""), "image bytes");
  reopened.completeSend("a lost response has no admission evidence");
  assert.deepEqual(current(reopened), sent);
  reopened.update((value) => ({ ...value, text: "A newer edit" }));
  reopened.completeSend(sent.requestId);
  assert.equal(current(reopened).text, "A newer edit");
  assert.deepEqual(current(reopened).images, sent.images);
  reopened.completeSend(current(reopened).requestId);
  await saved(reopened);
  assert.equal(current(reopened).text, "");
  assert.equal(current(reopened).images.length, 0);
});

test("release reload waits for the actual image draft save and restores its bytes and IDs", async () => {
  const persistence = memory();
  const draft = createChatDraft(persistence, () => {});
  await draft.load();
  await saved(draft);
  let finish = () => {};
  const commit = persistence.save.bind(persistence);
  persistence.save = async (value) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    await commit(value);
  };
  const images = await readImageFiles([
    new File(["release image"], "reload.png", { type: "image/png" }),
  ]);
  draft.update((value) => ({ ...value, text: "Keep this", images }));
  let reloads = 0;
  const observe = createReleaseObserver(
    draft.prepareReload,
    () => {
      reloads++;
    },
    "old",
  );
  assert(observe("new"));
  assert.equal(reloads, 0);
  finish();
  await saved(draft);
  assert(!observe("new"));
  assert.equal(reloads, 1);
  persistence.save = commit;
  const reopened = createChatDraft(persistence, () => {});
  await reopened.load();
  await saved(reopened);
  assert.deepEqual(current(reopened), current(draft));
});

test("draft writes coalesce, block reload until durable and retain input when storage fails", async () => {
  let release = () => {};
  let writes = 0;
  const values: ChatDraft[] = [];
  const persistence: DraftPersistence = {
    async load() {
      return undefined;
    },
    async save(value) {
      writes++;
      values.push(value);
      if (writes === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
    },
  };
  const draft = createChatDraft(persistence, () => {});
  await draft.load();
  draft.update((value) => ({ ...value, text: "first" }));
  draft.update((value) => ({ ...value, text: "latest" }));
  assert(!draft.prepareReload());
  release();
  await saved(draft);
  assert.equal(writes, 2);
  assert.equal(values.at(-1)?.text, "latest");
  persistence.save = async () => {
    throw new Error("quota");
  };
  draft.update((value) => ({ ...value, text: "Retain me" }));
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(current(draft).text, "Retain me");
  assert(!draft.prepareReload());
  persistence.save = async () => {};
  draft.retrySave();
  await saved(draft);
});

test("corrupt or unavailable saved drafts are never replaced by empty data", async () => {
  const persistence = memory();
  persistence.value = { text: "Important", images: "invalid" };
  const draft = createChatDraft(persistence, () => {});
  await draft.load();
  assert.equal(draft.read().kind, "error");
  assert.deepEqual(persistence.value, { text: "Important", images: "invalid" });
  assert(!draft.prepareReload());
  persistence.value = {
    requestId: crypto.randomUUID(),
    text: "Keep corrupt image",
    images: [
      {
        id: crypto.randomUUID(),
        name: "broken.png",
        mimeType: "image/png",
        data: "bad!",
      },
    ],
  };
  await draft.load();
  assert.equal(draft.read().kind, "error");
  assert.equal(typeof persistence.value, "object");
  persistence.value = undefined;
  await draft.load();
  await saved(draft);
  assert.equal(draft.read().kind, "ready");
});

test("file input bounds and duplicate removal run before draft upload", async () => {
  await assert.rejects(
    readImageFiles([new File(["svg"], "x.svg", { type: "image/svg+xml" })]),
  );
  await assert.rejects(
    readImageFiles([
      new File([new Uint8Array(imageLimits.bytes + 1)], "x.png", {
        type: "image/png",
      }),
    ]),
  );
  const images = await readImageFiles([
    new File(["png"], "x.png", { type: "image/png" }),
  ]);
  const duplicate = await readImageFiles([
    new File(["png"], "different.png", { type: "image/png" }),
  ]);
  assert.equal(appendImages(images, duplicate).length, 1);
  assert.equal(appendImages(images, []).at(0)?.id, images[0]?.id);
  const image = images[0];
  assert(image);
  assert.throws(() =>
    appendImages(
      [],
      Array.from({ length: 5 }, (_, n) => ({
        ...image,
        id: crypto.randomUUID(),
        data: String(n),
      })),
    ),
  );
});
