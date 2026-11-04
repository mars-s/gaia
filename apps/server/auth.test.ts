import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createAuth } from "./auth.ts";
test("credential writes are serialised, survive reopening, metadata hides secrets", async () => {
  const db = new DatabaseSync(":memory:");
  const auth = createAuth(db);
  await auth.store.modify("openai-codex", async () => ({
    type: "oauth",
    access: "test-access",
    refresh: "test-refresh",
    expires: 1,
  }));
  const order: number[] = [];
  await Promise.all([
    auth.store.modify("openai-codex", async (current) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(1);
      assert.equal(current?.type, "oauth");
      return {
        type: "oauth",
        access: "updated",
        refresh: "test-refresh",
        expires: 2,
      };
    }),
    auth.store.modify("openai-codex", async (current) => {
      order.push(2);
      assert.equal(current?.type === "oauth" && current.access, "updated");
      return current;
    }),
  ]);
  assert.deepEqual(order, [1, 2]);
  assert.deepEqual(await auth.store.list(), [
    { providerId: "openai-codex", type: "oauth" },
  ]);
  const reopened = createAuth(db);
  assert.equal((await reopened.store.read("openai-codex"))?.type, "oauth");
  assert(!JSON.stringify(reopened.status()).includes("updated"));
  await reopened.store.delete("openai-codex");
  assert.equal(await reopened.store.read("openai-codex"), undefined);
  await auth.close();
  await reopened.close();
  db.close();
});
