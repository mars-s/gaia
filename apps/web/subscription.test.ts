import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { subscribe } from "../../packages/sdk/index.ts";
import type { Snapshot } from "../../packages/protocol/index.ts";

const snapshot: Snapshot = {
  connection: { kind: "connected", model: "gpt-6.1-sol" },
  thread: { version: 1, id: "local", messages: [], run: { kind: "idle" } },
};
class Stream {
  static instances: Stream[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  closed = false;
  constructor() {
    Stream.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  send(state: Snapshot) {
    this.onmessage?.({
      data: JSON.stringify({ type: "snapshot", data: state }),
    });
  }
}

function install(t: TestContext) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "EventSource");
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: Stream,
  });
  Stream.instances = [];
  t.after(() => {
    if (descriptor)
      Object.defineProperty(globalThis, "EventSource", descriptor);
    else Reflect.deleteProperty(globalThis, "EventSource");
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
}

test("SSE errors recover fresh idle state and explicitly replace disconnected streams", async (t) => {
  install(t);
  t.mock.method(globalThis, "fetch", async () => Response.json(snapshot));
  const received: Snapshot[] = [];
  let errors = 0;
  const stop = subscribe(
    (state) => received.push(state),
    () => {
      errors++;
    },
  );
  const first = Stream.instances[0];
  first.onerror?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(first.closed, true);
  assert.equal(received.at(-1)?.thread.run.kind, "idle");
  t.mock.timers.tick(1000);
  assert.equal(Stream.instances.length, 2);
  assert.equal(errors, 1);
  stop();
  t.mock.timers.tick(30000);
  assert.equal(Stream.instances.length, 2);
});

test("silent idle stream stalls reconnect and late recovery cannot overwrite a newer snapshot", async (t) => {
  install(t);
  let deliver: (response: Response) => void = () => {};
  t.mock.method(
    globalThis,
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        deliver = resolve;
      }),
  );
  const received: Snapshot[] = [];
  const stop = subscribe(
    (state) => received.push(state),
    () => {},
  );
  Stream.instances[0].onopen?.();
  Stream.instances[0].send({
    ...snapshot,
    thread: { ...snapshot.thread, run: { kind: "stopped" } },
  });
  deliver(Response.json(snapshot));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(
    received.map((state) => state.thread.run.kind),
    ["stopped"],
  );
  t.mock.timers.tick(10000);
  assert.equal(Stream.instances[0].closed, true);
  t.mock.timers.tick(1000);
  assert.equal(Stream.instances.length, 2);
  stop();
});

test("disposing aborts recovery, ignores retired stream callbacks and cancels reconnect work", async (t) => {
  install(t);
  let recoverySignal: AbortSignal | null | undefined;
  t.mock.method(globalThis, "fetch", (_url: string, options: RequestInit) => {
    recoverySignal = options.signal;
    return new Promise<Response>(() => {});
  });
  let states = 0;
  const stop = subscribe(
    () => {
      states++;
    },
    () => {},
  );
  const old = Stream.instances[0];
  old.onerror?.();
  old.send(snapshot);
  old.onerror?.();
  assert.equal(states, 0);
  stop();
  assert.equal(recoverySignal?.aborted, true);
  t.mock.timers.tick(60000);
  assert.equal(Stream.instances.length, 1);
  await Promise.resolve();
});
