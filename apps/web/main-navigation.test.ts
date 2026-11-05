import assert from "node:assert/strict";
import { test } from "node:test";
import { createMainRestore, createNavigationGuard } from "./main-navigation.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("StrictMode cleanup allows the second main restore and only it can open", async () => {
  const start = createMainRestore();
  const pending: { allow(): boolean; resolve(value: boolean): void }[] = [];
  let opens = 0;
  const restore = (allow: () => boolean) =>
    new Promise<boolean>((resolve) => {
      pending.push({ allow, resolve });
    });
  const stop = start(
    restore,
    () => true,
    () => opens++,
  );
  stop();
  const finish = start(
    restore,
    () => true,
    () => opens++,
  );
  assert.equal(pending.length, 2);
  assert.equal(pending[0].allow(), false);
  assert.equal(pending[1].allow(), true);
  pending.forEach((p) => p.resolve(true));
  await tick();
  assert.equal(opens, 1);
  finish();
});

for (const operation of ["restore", "inline use"] as const) {
  test(`${operation} rejects navigation away and back and changed drafts`, async () => {
    let draft = "original draft";
    const navigation = createNavigationGuard(() => draft);
    const allowed = navigation.capture();
    assert.equal(allowed(), true);
    navigation.moved();
    navigation.moved();
    assert.equal(allowed(), false);
    const beforeEdit = navigation.capture();
    draft = "owner edited draft";
    assert.equal(beforeEdit(), false);
  });
}

test("main restore checks the guard again before opening its view", async () => {
  let allowed = true;
  let opens = 0;
  createMainRestore()(
    async () => true,
    () => allowed,
    () => opens++,
  );
  allowed = false;
  await tick();
  assert.equal(opens, 0);
});

test("cancelling restore after owner navigation never arms another automatic restore", () => {
  const navigation = createNavigationGuard(() => "draft");
  const start = createMainRestore();
  let requests = 0;
  const restore = () => {
    requests++;
    return new Promise<boolean>(() => {});
  };
  const stop = start(restore, navigation.capture(), () =>
    assert.fail("Must not open"),
  );
  navigation.moved();
  stop();
  start(restore, navigation.capture(), () => assert.fail("Must not open"));
  assert.equal(requests, 1);
});
