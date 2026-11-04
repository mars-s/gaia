import assert from "node:assert/strict";
import { test } from "node:test";
import { readManaged, revertChange } from "../../packages/sdk/managed.ts";
import { watchManaged } from "./managed-history.ts";

const id = "c924b512-70d4-4c73-a11a-69d93f993802";
const change = {
  id,
  reason: "Smaller composer",
  at: "2026-11-04",
  diff: "real diff",
  checks: ["typecheck passed"],
  outcome: "queued",
  detail: "Checks queued",
};
const status = {
  version: 1,
  kind: "stable",
  busy: false,
  selfModification: true,
};

test("management boundary omits plain-dev 404, validates versions and JSON and rejects unknown outcomes", async (t) => {
  const responses: Response[] = [];
  const calls: RequestInit[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, options: RequestInit) => {
      calls.push(options);
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
  );
  const signal = new AbortController().signal;
  responses.push(new Response("Not found", { status: 404 }));
  assert.equal(await readManaged(signal), null);
  assert.equal(calls.length, 1);
  responses.push(Response.json({ ...status, version: 2 }));
  await assert.rejects(readManaged(signal), /unsupported change details/);
  responses.push(new Response("<html>restarting</html>"));
  await assert.rejects(readManaged(signal), /could not be read/);
  responses.push(
    Response.json(status),
    Response.json({ version: 1, changes: [{ ...change, outcome: "success" }] }),
  );
  await assert.rejects(readManaged(signal), /unsupported change details/);
  responses.push(
    Response.json({ error: "Safe mode refuses revert" }, { status: 503 }),
  );
  await assert.rejects(revertChange(id, signal), /Safe mode refuses revert/);
  assert.equal(calls.at(-1)?.method, "POST");
  assert.equal(calls.at(-1)?.body, JSON.stringify({ id }));
  responses.push(Response.json(change, { status: 202 }));
  assert.equal((await revertChange(id, signal)).outcome, "queued");
});

test("history polling waits through queued to accepted, then stops", async () => {
  let reads = 0;
  let finish: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const outcomes: string[] = [];
  const stop = watchManaged({
    waitingFor: id,
    interval: 1,
    read: async () => ({
      status: { ...status, version: 1, kind: "stable" },
      changes: [{ ...change, outcome: ++reads === 1 ? "queued" : "accepted" }],
    }),
    publish(view) {
      outcomes.push(view?.changes[0].outcome ?? "missing");
      if (outcomes.at(-1) === "accepted") finish();
    },
    fail: (message) => assert.fail(message),
  });
  await finished;
  stop();
  assert.deepEqual(outcomes, ["queued", "accepted"]);
  assert.equal(reads, 2);
});

test("closing or superseding history prevents a late response publishing", async () => {
  let deliver: (value: null) => void = () => {};
  const late = new Promise<null>((resolve) => {
    deliver = resolve;
  });
  const stop = watchManaged({
    read: () => late,
    publish: () => assert.fail("stale result"),
    fail: () => assert.fail("stale error"),
  });
  stop();
  deliver(null);
  await late;
});

test("polling failures stop at the configured bound and offer refresh", async () => {
  let reads = 0;
  let finish: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const messages: string[] = [];
  const stop = watchManaged({
    interval: 1,
    limit: 2,
    read: async () => {
      reads++;
      throw new Error("Disconnected. Refresh shortly.");
    },
    publish: () => assert.fail("failed read published"),
    fail(message) {
      messages.push(message);
      if (message.includes("still being checked")) finish();
    },
  });
  await finished;
  stop();
  assert.equal(reads, 2);
  assert.match(messages.at(-1) ?? "", /Refresh history/);
});
