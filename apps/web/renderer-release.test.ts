import assert from "node:assert/strict";
import { test } from "node:test";
import { createDraftStore, createReleaseObserver } from "./renderer-release.ts";

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
}

test("release A to B to A reloads each loaded renderer once and recovers its draft", () => {
  const storage = memoryStorage();
  let reloads = 0;
  const draft = createDraftStore(() => storage);
  const observe = createReleaseObserver(draft.prepareReload, () => {
    reloads++;
  });
  observe(undefined);
  observe("A");
  observe("A");
  assert.equal(reloads, 0);
  draft.save("my unsent question");
  observe("B");
  observe("B");
  observe("A");
  assert.equal(reloads, 1);
  const nextDraft = createDraftStore(() => storage);
  assert.equal(nextDraft.read(), "my unsent question");
  const next = createReleaseObserver(nextDraft.prepareReload, () => {
    reloads++;
  });
  next("B");
  next("B");
  assert.equal(reloads, 1);
  next("A");
  next("A");
  assert.equal(reloads, 2);
  const rollback = createReleaseObserver(
    () => true,
    () => {
      reloads++;
    },
  );
  rollback("A");
  rollback("A");
  assert.equal(reloads, 2);
});

test("blocked storage keeps draft in memory and defers reload until safe", () => {
  const storage = memoryStorage();
  let blocked = true;
  const access = () => {
    if (blocked) throw new Error("storage disabled");
    return storage;
  };
  const draft = createDraftStore(access);
  draft.save("keep this");
  let reloads = 0;
  const observe = createReleaseObserver(draft.prepareReload, () => {
    reloads++;
  });
  observe("A");
  assert.equal(observe("B"), true);
  assert.equal(observe("B"), true);
  assert.equal(draft.read(), "keep this");
  assert.equal(reloads, 0);
  blocked = false;
  observe("B");
  assert.equal(reloads, 1);
  assert.equal(createDraftStore(access).read(), "keep this");
});

test("send completion cannot erase a newer draft; blocked storage also permits empty-draft reload", () => {
  const draft = createDraftStore(() => {
    throw new Error("blocked");
  });
  draft.save("sent");
  draft.save("newer");
  assert.equal(draft.completeSend("sent"), "newer");
  assert.equal(draft.completeSend("newer"), "");
  assert.equal(draft.prepareReload(), true);
});

test("write and removal failures do not interrupt chat or drop the in-memory draft", () => {
  const draft = createDraftStore(() => ({
    getItem: () => "restored",
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  }));
  assert.equal(draft.read(), "restored");
  assert.equal(draft.save("new"), false);
  assert.equal(draft.read(), "new");
  assert.equal(draft.prepareReload(), false);
  assert.equal(draft.completeSend("new"), "");
});
