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
  const oldSignal = signal;
  sources[0]?.onerror?.(new Event("error"));
  assert.equal(errors, 1);
  assert.equal(oldSignal?.aborted, true);
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
  const html = createExperienceClient({
    fetch: async () =>
      new Response("<html>Proxy unavailable</html>", { status: 502 }),
    events: stream,
  });
  await assert.rejects(html.index(), /unreadable response/);
});

type TransportSource = ReturnType<ExperienceTransport["events"]>;
class SilentSource extends EventTarget {
  onmessage: TransportSource["onmessage"] = null;
  onerror: TransportSource["onerror"] = null;
  onopen: TransportSource["onopen"] = null;
  closed = false;
  close() {
    this.closed = true;
  }
}
test("named heartbeats keep an idle scope alive, while silent stalls recover fresh state", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sources: SilentSource[] = [];
  const revisions: number[] = [];
  let offline = 0;
  const client = createExperienceClient({
    fetch: async () => Response.json(snapshot(6)),
    events: () => {
      const source = new SilentSource();
      sources.push(source);
      return source;
    },
  });
  const close = client.subscribe(
    pid,
    sid,
    (value) => revisions.push(value.revision),
    () => offline++,
  );
  t.after(close);
  const first = sources[0];
  first.onmessage?.(
    new MessageEvent("message", { data: JSON.stringify(snapshot(5)) }),
  );
  t.mock.timers.tick(9000);
  first.dispatchEvent(new Event("heartbeat"));
  t.mock.timers.tick(9000);
  assert.equal(first.closed, false);
  t.mock.timers.tick(1001);
  assert.equal(first.closed, true);
  await tick();
  assert.equal(revisions.at(-1), 6);
  assert.equal(offline, 1);
  first.onmessage?.(
    new MessageEvent("message", { data: JSON.stringify(snapshot(99)) }),
  );
  assert.equal(revisions.at(-1), 6);
  t.mock.timers.tick(501);
  assert.equal(sources.length, 2);
  close();
  t.mock.timers.tick(30000);
  assert.equal(sources.length, 2);
});

test("scope recovery has a five-second deadline and disposal rejects late replies", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const held = deferred<Response>();
  let signal: AbortSignal | null | undefined;
  const source = new SilentSource();
  const received: number[] = [];
  const client = createExperienceClient({
    fetch: async (_url, init) => {
      signal = init?.signal;
      return held.promise;
    },
    events: () => source,
  });
  const close = client.subscribe(
    pid,
    sid,
    (value) => received.push(value.revision),
    () => {},
  );
  t.after(close);
  source.onopen?.(new Event("open"));
  t.mock.timers.tick(5000);
  assert.equal(signal?.aborted, true);
  close();
  held.resolve(Response.json(snapshot(12)));
  await tick();
  assert.deepEqual(received, []);
  t.mock.timers.tick(30000);
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
