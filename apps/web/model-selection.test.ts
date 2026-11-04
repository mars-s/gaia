import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelSelection } from "../../packages/protocol/index.ts";
import { createModelSelectionQueue } from "./model-selection.ts";

test("rapid effort input applies the latest value and serialises edits made during a request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const applied: ModelSelection[] = [];
  const displayed: (ModelSelection | undefined)[] = [];
  let finish: (value: boolean) => void = () => {};
  const queue = createModelSelectionQueue(
    (selection) => {
      applied.push(selection);
      return new Promise<boolean>((resolve) => {
        finish = resolve;
      });
    },
    (value) => displayed.push(value),
  );
  queue.select({ modelId: "gpt-6.1-sol", thinkingLevel: "low" });
  queue.select({ modelId: "gpt-6.1-sol", thinkingLevel: "medium" });
  t.mock.timers.tick(150);
  assert.deepEqual(applied, [
    { modelId: "gpt-6.1-sol", thinkingLevel: "medium" },
  ]);
  queue.select({ modelId: "gpt-6.1-sol", thinkingLevel: "high" });
  queue.select({ modelId: "gpt-6.1-sol", thinkingLevel: "max" });
  t.mock.timers.tick(150);
  assert.equal(applied.length, 1);
  finish(true);
  await Promise.resolve();
  t.mock.timers.tick(150);
  assert.deepEqual(applied.at(-1), {
    modelId: "gpt-6.1-sol",
    thinkingLevel: "max",
  });
  assert.equal(applied.length, 2);
  finish(false);
  await Promise.resolve();
  assert.equal(
    displayed.at(-1),
    undefined,
    "failed final requests return to authoritative settings",
  );
  queue.dispose();
});

test("disposing the model picker cancels edits that have not been submitted", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const queue = createModelSelectionQueue(
    async () => {
      calls++;
      return true;
    },
    () => {},
  );
  queue.select({ modelId: "gpt-6.1-sol", thinkingLevel: "high" });
  queue.dispose();
  t.mock.timers.tick(150);
  assert.equal(calls, 0);
});
