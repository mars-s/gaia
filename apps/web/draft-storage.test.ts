import assert from "node:assert/strict";
import { test } from "node:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { browserDraftPersistence, ChatDraft } from "./chat-draft.ts";

test("IndexedDB migrates local Home references, isolates area bytes and saves text without rewriting image data", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const factory = new IDBFactory();
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: factory,
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  });
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("gaia-chat-drafts", 2);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("drafts");
      request.result.createObjectStore("images");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const old = ChatDraft.parse({
    requestId: crypto.randomUUID(),
    text: "Retained Home",
    images: [
      {
        id: crypto.randomUUID(),
        name: "home.png",
        mimeType: "image/png",
        data: btoa("Home bytes"),
      },
    ],
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["drafts", "images"], "readwrite");
    tx.objectStore("drafts").put(
      {
        version: 2,
        requestId: old.requestId,
        text: old.text,
        imageIds: old.images.map((image) => image.id),
      },
      "local",
    );
    tx.objectStore("images").put(old.images[0], old.images[0].id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const add = IDBObjectStore.prototype.add;
  const put = IDBObjectStore.prototype.put;
  let imageWrites = 0;
  t.mock.method(
    IDBObjectStore.prototype,
    "add",
    function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === "images") imageWrites++;
      return add.call(this, value, key);
    },
  );
  t.mock.method(
    IDBObjectStore.prototype,
    "put",
    function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === "images") imageWrites++;
      return put.call(this, value, key);
    },
  );
  const home = browserDraftPersistence("local");
  const restored = ChatDraft.parse(await home.load());
  assert.deepEqual(restored, old);
  await home.save(restored);
  const area = browserDraftPersistence("area:synthetic");
  const areaDraft = {
    ...old,
    requestId: crypto.randomUUID(),
    text: "Area draft",
    images: [{ ...old.images[0], data: btoa("Area bytes") }],
  };
  await area.save(areaDraft);
  assert.equal(imageWrites, 2);
  for (const text of ["New", "Newer", "Newest"])
    await area.save({ ...areaDraft, text });
  assert.equal(imageWrites, 2, "Keystrokes only update metadata.");
  assert.deepEqual(await browserDraftPersistence("local").load(), old);
  assert.deepEqual(await browserDraftPersistence("area:synthetic").load(), {
    ...areaDraft,
    text: "Newest",
  });
  assert.equal(await browserDraftPersistence("area:empty").load(), undefined);
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const tx = db.transaction(["drafts", "images"], "readonly");
    const request = tx.objectStore("images").getAllKeys();
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
  assert(
    keys.includes(old.images[0].id),
    "Migration retains the original image record.",
  );
  assert(keys.includes(`local:${old.images[0].id}`));
  assert(keys.includes(`area:synthetic:${old.images[0].id}`));
  db.close();
});
