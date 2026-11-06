import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionRecency, setupContext } from "./setup-context";

test("session dates use calendar days, including month boundaries, without inventing timestamps", () => {
  const now = new Date(2026, 10, 1, 10);
  assert.equal(sessionRecency(undefined, now), undefined);
  assert.equal(sessionRecency("now", now), undefined);
  assert.equal(sessionRecency(new Date(2026, 10, 1, 1).toISOString(), now), "today");
  assert.equal(sessionRecency(new Date(2026, 9, 31, 23).toISOString(), now), "yesterday");
  assert.equal(sessionRecency(new Date(2025, 9, 30).toISOString(), now), "30 Oct 2025");
  assert.match(setupContext.sessions.change, /New remembered facts are shared/);
  assert.match(setupContext.bots.change, /own memory/);
  assert.match(setupContext.channels.change, /separate conversations/);
});
