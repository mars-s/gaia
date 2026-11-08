import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  decisionService,
  fakeDecisionProvider,
  decisionMeter,
  type IntentDecision,
} from "./views/decisions.ts";
const decision: IntentDecision = {
  view: "comparison",
  mode: "new",
  confidence: 0.9,
};
const input = {
  intent: "Compare East sales",
  currentView: false,
  columns: ["Sales"],
};
const date = () => new Date("2026-11-08T00:00:00Z");

test("hosted decisions default off and plan failures fall back locally", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    let calls = 0;
    const service = decisionService({
      db,
      plan: async () => decision,
      hosted: {
        maxChargeMicroUsd: 1,
        async decide() {
          calls++;
          throw new Error();
        },
      },
    });
    assert.equal(service.config.enabled, false);
    assert.equal(service.config.monthlyCapMicroUsd, 10_000_000);
    assert.equal((await service.decide(input)).source, "plan");
    assert.equal(calls, 0);
    const fallback = decisionService({
      db,
      plan: async () => {
        throw new Error();
      },
    });
    const result = await fallback.decide({
      ...input,
      intent: ", chart East by week",
      currentView: true,
    });
    assert.equal(result.source, "local");
    assert.equal(result.decision.view, "chart");
    assert.equal(result.decision.mode, "refine");
  } finally {
    db.close();
  }
});

test("concurrent requests cannot exceed cap and failed charges stay reserved", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const service = decisionService({
      db,
      now: date,
      settings: { enabled: true, monthlyCapMicroUsd: 200 },
      plan: async () => decision,
      hosted: fakeDecisionProvider({ decision }),
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.decide(input)),
    );
    assert.equal(results.filter((r) => r.source === "hosted").length, 2);
    assert.equal(service.meter.spent("2026-11"), 200);
    const failed = decisionService({
      db,
      now: () => new Date("2026-12-01"),
      settings: { enabled: true, monthlyCapMicroUsd: 100 },
      plan: async () => decision,
      hosted: fakeDecisionProvider({ decision, fail: true }),
    });
    assert.equal((await failed.decide(input)).source, "plan");
    assert.equal(failed.meter.spent("2026-12"), 100);
    assert.equal((await failed.decide(input)).source, "plan");
  } finally {
    db.close();
  }
});

test("meter survives reopen, releases only confirmed charges and separates months", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-intent-budget-"));
  let db = new DatabaseSync(join(dir, "meter.sqlite"));
  try {
    const meter = decisionMeter(db);
    const id = meter.reserve("2026-11", 100, 100);
    assert.ok(id);
    db.close();
    db = new DatabaseSync(join(dir, "meter.sqlite"));
    const reopened = decisionMeter(db);
    assert.equal(reopened.reserve("2026-11", 1, 100), undefined);
    assert.throws(() => reopened.settle(id, 101), /limit/);
    assert.equal(reopened.spent("2026-11"), 100);
    reopened.settle(id, 50);
    assert.equal(reopened.spent("2026-11"), 50);
    assert.throws(() => reopened.settle(id, 0));
    assert.ok(reopened.reserve("2026-12", 100, 100));
    assert.throws(() => reopened.reserve("2026-12", -1, 100));
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
