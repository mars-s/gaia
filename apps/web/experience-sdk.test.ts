import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createExperienceClient,
  type ExperienceTransport,
} from "../../packages/sdk/experiences.ts";
import {
  ExperienceId,
  ScopeId,
  ExperienceScopeState,
} from "../../packages/protocol/experiences.ts";
const pid = ExperienceId.parse("11111111-1111-4111-8111-111111111111");
const sid = ScopeId.parse("22222222-2222-4222-8222-222222222222");
function snapshot(revision: number) {
  return ExperienceScopeState.parse({
    version: 1,
    profileId: pid,
    scope: {
      id: sid,
      profileId: pid,
      label: "Test",
      purpose: "Test",
      createdAt: "now",
    },
    revision,
    messages: [],
    jobs: [],
    chat: { models: [], modelId: "test", compaction: { kind: "idle" } },
    memoryRevision: 0,
  });
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function stream() {
  return {
    onopen: null,
    onmessage: null,
    onerror: null,
    close() {
      this.closed = true;
    },
    closed: false,
  } satisfies ReturnType<ExperienceTransport["events"]> & { closed: boolean };
}
test("SSE reconnect rejects stale recovery and old source events, closes requests and timers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sources: ReturnType<ExperienceTransport["events"]>[] = [];
  const closes: boolean[] = [];
  const recovery = deferred<Response>();
  let signal: AbortSignal | null | undefined;
  const client = createExperienceClient({
    fetch: async (_url, options) => {
      signal = options?.signal;
      return recovery.promise;
    },
    events: () => {
      const source: ReturnType<ExperienceTransport["events"]> = {
        ...stream(),
        close: () => {
          closes.push(true);
        },
      };
      sources.push(source);
      return source;
    },
  });
  const revisions: number[] = [];
  let errors = 0;
  const close = client.subscribe(
    pid,
    sid,
    (value) => revisions.push(value.revision),
    () => {
      errors++;
    },
  );
  sources[0]?.onopen?.(new Event("open"));
  sources[0]?.onmessage?.(
    new MessageEvent("message", { data: JSON.stringify(snapshot(5)) }),
  );
  recovery.resolve(Response.json(snapshot(2)));
  await tick();
  assert.deepEqual(revisions, [5]);
  sources[0]?.onerror?.(new Event("error"));
  assert.equal(errors, 1);
  assert.equal(signal?.aborted, true);
  t.mock.timers.tick(501);
  assert.equal(sources.length, 2);
  sources[0]?.onmessage?.(
    new MessageEvent("message", { data: JSON.stringify(snapshot(10)) }),
  );
  sources[1]?.onmessage?.(
    new MessageEvent("message", { data: JSON.stringify(snapshot(6)) }),
  );
  assert.deepEqual(revisions, [5, 6]);
  close();
  t.mock.timers.tick(10000);
  assert.equal(sources.length, 2);
  assert.equal(closes.length, 2);
});
test("SDK rejects wrong-scope snapshots and uses scoped upload and attachment URLs", async () => {
  const calls: string[] = [];
  const client = createExperienceClient({
    fetch: async (url) => {
      calls.push(String(url));
      return Response.json({ ...snapshot(1), profileId: crypto.randomUUID() });
    },
    events: stream,
  });
  await assert.rejects(client.scope(pid, sid), /unreadable response/);
  assert.equal(calls[0], `/api/v1/experiences/${pid}/scopes/${sid}/state`);
  const aid = crypto.randomUUID();
  assert.equal(
    client.attachmentUrl(pid, sid, aid),
    `/api/v1/experiences/${pid}/scopes/${sid}/attachments/${aid}`,
  );
});
test("friendly server errors and failed transport preserve actionable recovery text", async () => {
  const denied = createExperienceClient({
    fetch: async () =>
      Response.json({ error: "Admission closed" }, { status: 503 }),
    events: stream,
  });
  await assert.rejects(denied.index(), /Admission closed/);
  const lost = createExperienceClient({
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
    events: stream,
  });
  await assert.rejects(lost.index(), /Your draft is here/);
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw Error("Promise not initialised");
  };
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
