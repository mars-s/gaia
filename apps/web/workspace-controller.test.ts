import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorkspaceController,
  homeScope,
} from "./workspace-controller.ts";
import {
  areaSnapshot,
  deferred,
  firstArea,
  multiWorkspace,
  secondArea,
  settle,
} from "./conversation-fixtures.ts";
import type { AreaSnapshot } from "../../packages/sdk/areas.ts";

test("latest area read wins, command results fence polls, and retired scope reads cannot publish", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const waits: {
    result: ReturnType<typeof deferred<AreaSnapshot>>;
    signal?: AbortSignal;
  }[] = [];
  let delay = false;
  const source = createWorkspaceController(() => {}, {
    async readWorkspace() {
      return multiWorkspace();
    },
    async readArea(id, signal) {
      if (!delay) return areaSnapshot(id);
      const result = deferred<AreaSnapshot>();
      waits.push({ result, signal });
      return result.promise;
    },
  });
  source.setConnected(true);
  await settle();
  delay = true;
  const old = source.refreshArea(firstArea);
  const latest = source.refreshArea(firstArea);
  assert(waits[0]?.signal?.aborted);
  const fresh = areaSnapshot();
  fresh.thread.messages.push({
    id: "new",
    role: "assistant",
    text: "New answer",
    createdAt: "now",
  });
  waits[1]?.result.resolve(fresh);
  await latest;
  waits[0]?.result.resolve(areaSnapshot());
  await old;
  assert.equal(
    source.areas.get(firstArea)?.snapshot?.thread.messages[0]?.text,
    "New answer",
  );
  const poll = source.refreshArea(firstArea);
  const finish = source.beginCommand(firstArea);
  const running = areaSnapshot();
  running.thread.run = { kind: "running", id: "accepted" };
  finish(running);
  waits[2]?.result.resolve(areaSnapshot());
  await poll;
  assert.equal(
    source.areas.get(firstArea)?.snapshot?.thread.run.kind,
    "running",
  );
  waits[3]?.result.resolve(running);
  await settle();
  source.select({ kind: "area", areaId: secondArea });
  source.select(homeScope);
  assert(
    waits[4]?.signal?.aborted,
    "Leaving an idle area cancels its outstanding read.",
  );
  const wrong = areaSnapshot(secondArea);
  wrong.thread.messages.push({
    id: "late",
    role: "assistant",
    text: "Stale answer",
    createdAt: "now",
  });
  waits[4]?.result.resolve(wrong);
  await settle();
  assert.equal(
    source.areas.get(secondArea)?.snapshot?.thread.messages.length,
    0,
  );
  source.setConnected(false);
  t.mock.timers.tick(60000);
  assert.equal(waits.length, 5, "Pausing cancels poll and discovery timers.");
});

test("a direct running area keeps polling while Home is selected without polling every area each second", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: string[] = [];
  let active = true;
  const source = createWorkspaceController(() => {}, {
    async readWorkspace() {
      return multiWorkspace();
    },
    async readArea(id) {
      calls.push(id);
      const result = areaSnapshot(id);
      if (active && id === firstArea)
        result.thread.run = { kind: "running", id: "direct" };
      return result;
    },
  });
  source.setConnected(true);
  await settle();
  assert.equal(source.busy(), firstArea);
  assert.equal(calls.filter((id) => id === secondArea).length, 1);
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(calls.filter((id) => id === firstArea).length, 2);
  assert.equal(calls.filter((id) => id === secondArea).length, 1);
  active = false;
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(source.busy(), undefined);
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(
    calls.length,
    4,
    "An inactive unselected area stops its fast polling.",
  );
  source.setConnected(false);
});

test("failed and mismatched area reads retain history, prevent writes and recover on refresh", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let broken = false;
  const source = createWorkspaceController(() => {}, {
    async readWorkspace() {
      return multiWorkspace();
    },
    async readArea(id) {
      return areaSnapshot(broken ? secondArea : id);
    },
  });
  source.setConnected(true);
  await settle();
  assert(source.ready());
  broken = true;
  await source.refreshArea(firstArea);
  assert(!source.ready());
  assert.equal(source.areas.get(firstArea)?.status, "reconnecting");
  assert.equal(source.areas.get(firstArea)?.snapshot?.areaId, firstArea);
  broken = false;
  await source.refresh();
  await settle();
  assert(source.ready());
  source.setConnected(false);
});
