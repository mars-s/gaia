import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createProfileReader,
  type OwnerState,
} from "../../packages/sdk/onboarding.ts";

test("profile reader ignores stale and aborted responses, bounds data and reports retryable failures", async () => {
  const pending: ((response: Response) => void)[] = [];
  const received: OwnerState[] = [];
  let failures = 0;
  const reader = createProfileReader(
    (value) => received.push(value),
    () => failures++,
    () => new Promise<Response>((resolve) => pending.push(resolve)),
  );
  const reply = (n: number, body: unknown) =>
    pending[n]?.(new Response(JSON.stringify(body)));
  const first = reader.refresh();
  const second = reader.refresh();
  reply(1, {
    kind: "ready",
    profile: {
      name: "Avi",
      purpose: "Study",
      lifeAreas: [],
      workingStyle: "chat",
    },
  });
  await second;
  reply(0, { kind: "new" });
  await first;
  assert.equal(received.length, 1);
  assert.equal(received[0]?.kind, "ready");
  const third = reader.refresh();
  reader.cancel();
  reply(2, { kind: "new" });
  await third;
  assert.equal(received.length, 1);
  assert.equal(failures, 0);
  const fourth = reader.refresh();
  reply(3, "x".repeat(20000));
  await fourth;
  assert.equal(failures, 1);
  assert.equal(received.length, 1);
  const fifth = reader.refresh();
  reply(4, { kind: "skipped" });
  await fifth;
  assert.equal(received.at(-1)?.kind, "skipped");
});
