import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomic } from "./state.ts";
import { machineGate } from "./machine-gate.ts";

test("machine dispatch reads current protected identity and mode without HTTP traffic", async (t) => {
  const data = await mkdtemp(join(tmpdir(), "gaia-machine-gate-"));
  t.after(() => rm(data, { recursive: true, force: true }));
  const pair = { release: "a".repeat(40), generation: randomUUID(), schema: 1 };
  const next = { release: "b".repeat(40), generation: randomUUID(), schema: 1 };
  const base = { active: pair, good: pair, failures: 0 };
  const path = join(data, "control/manifest.json");
  const gate = machineGate(data, pair);
  assert.equal(gate(), "candidate");
  await atomic(path, { ...base, kind: "stable" });
  assert.equal(gate(), "stable");
  assert.equal(machineGate(data, next)(), "candidate");
  assert.equal(
    machineGate(data, { ...pair, generation: next.generation })(),
    "candidate",
  );
  assert.equal(machineGate(data, pair, true)(), "probe");
  await atomic(path, { ...base, kind: "checking", change: randomUUID() });
  assert.equal(gate(), "candidate");
  for (const kind of ["switching", "probing"])
    await atomic(path, {
      ...base,
      kind,
      change: randomUUID(),
      previous: pair,
      candidate: next,
    }).then(() => assert.equal(gate(), "candidate"));
  await atomic(path, { ...base, active: next, kind: "stable" });
  assert.equal(gate(), "candidate");
  assert.equal(machineGate(data, next)(), "stable");
  await atomic(path, { ...base, kind: "safe", reason: "Owned test" });
  assert.equal(gate(), "safe");
  await writeFile(path, "invalid control state");
  assert.equal(gate(), "candidate");
});
