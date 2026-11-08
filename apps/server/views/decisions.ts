import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

export const IntentDecision = z.strictObject({
  view: z.enum([
    "table",
    "chart",
    "stats",
    "document",
    "summary",
    "comparison",
    "timeline",
    "canvas",
    "reply",
    "self-change",
  ]),
  mode: z.enum(["new", "refine"]),
  confidence: z.number().min(0).max(1),
});
export type IntentDecision = z.infer<typeof IntentDecision>;
export const DecisionSettings = z.strictObject({
  enabled: z.boolean().default(false),
  monthlyCapMicroUsd: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .default(10_000_000),
});
export type DecisionSettings = z.infer<typeof DecisionSettings>;
export type DecisionInput = {
  intent: string;
  currentView: boolean;
  columns: string[];
};
export interface DecisionProvider {
  readonly maxChargeMicroUsd: number;
  decide(
    input: DecisionInput,
  ): Promise<{ decision: IntentDecision; chargedMicroUsd: number }>;
}
export type PlanDecision = (input: DecisionInput) => Promise<IntentDecision>;

export function localDecision(input: DecisionInput): IntentDecision {
  const text = input.intent.toLocaleLowerCase("en-AU");
  const choices: [RegExp, IntentDecision["view"]][] = [
    [/\bcanvas\b/, "canvas"],
    [/\bcompare|\bbehind|\bversus\b/, "comparison"],
    [/\bchart|\bgraph\b/, "chart"],
    [/\btable|\brows\b/, "table"],
    [/\bsummari[sz]e|\bsummary\b/, "summary"],
    [/\btimeline\b/, "timeline"],
    [/\bread|\bopen.*\b(?:pdf|docx)\b/, "document"],
    [/\btotal|\baverage\b/, "stats"],
  ];
  const view = choices.find(([pattern]) => pattern.test(text))?.[1] ?? "reply";
  return {
    view,
    mode: input.currentView && /^\s*,/.test(input.intent) ? "refine" : "new",
    confidence: view === "reply" ? 0 : 0.6,
  };
}

export function decisionMeter(db: DatabaseSync) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS intent_decision_charges (id TEXT PRIMARY KEY, month TEXT NOT NULL, micro_usd INTEGER NOT NULL CHECK(micro_usd >= 0), settled INTEGER NOT NULL DEFAULT 0)",
  );
  const sum = db.prepare(
    "SELECT COALESCE(SUM(micro_usd), 0) AS total FROM intent_decision_charges WHERE month = ?",
  );
  function spent(month: string) {
    return z.number().int().nonnegative().parse(sum.get(month)?.total);
  }
  return {
    spent,
    reserve(month: string, maxCharge: number, cap: number) {
      z.number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER)
        .parse(maxCharge);
      z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(cap);
      const id = randomUUID();
      const inserted = db
        .prepare(
          "INSERT INTO intent_decision_charges (id, month, micro_usd) SELECT ?, ?, ? WHERE COALESCE((SELECT SUM(micro_usd) FROM intent_decision_charges WHERE month = ?), 0) <= ?",
        )
        .run(id, month, maxCharge, month, cap - maxCharge);
      return inserted.changes === 1 ? id : undefined;
    },
    settle(id: string, actual: number) {
      z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(actual);
      const result = db
        .prepare(
          "UPDATE intent_decision_charges SET micro_usd = ?, settled = 1 WHERE id = ? AND settled = 0 AND micro_usd >= ?",
        )
        .run(actual, id, actual);
      if (result.changes !== 1)
        throw new Error("Decision charge is outside the reserved limit.");
    },
  };
}

export function decisionService({
  db,
  plan,
  hosted,
  settings = {},
  now = () => new Date(),
}: {
  db: DatabaseSync;
  plan: PlanDecision;
  hosted?: DecisionProvider;
  settings?: unknown;
  now?: () => Date;
}) {
  const config = DecisionSettings.parse(settings);
  const meter = decisionMeter(db);
  async function decide(input: DecisionInput) {
    if (config.enabled && hosted) {
      const max = hosted.maxChargeMicroUsd;
      if (Number.isSafeInteger(max) && max >= 0) {
        const reservation = meter.reserve(
          now().toISOString().slice(0, 7),
          max,
          config.monthlyCapMicroUsd,
        );
        if (reservation) {
          try {
            const result = await hosted.decide(input);
            const decision = IntentDecision.parse(result.decision);
            meter.settle(reservation, result.chargedMicroUsd);
            return { source: "hosted" as const, decision };
          } catch {
            /* An uncertain request keeps its reservation. */
          }
        }
      }
    }
    try {
      return {
        source: "plan" as const,
        decision: IntentDecision.parse(await plan(input)),
      };
    } catch {
      return { source: "local" as const, decision: localDecision(input) };
    }
  }
  return { decide, meter, config };
}

export function fakeDecisionProvider({
  decision,
  chargeMicroUsd = 100,
  fail = false,
}: {
  decision: IntentDecision;
  chargeMicroUsd?: number;
  fail?: boolean;
}): DecisionProvider {
  const value = IntentDecision.parse(decision);
  z.number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .parse(chargeMicroUsd);
  return {
    maxChargeMicroUsd: chargeMicroUsd,
    async decide() {
      if (fail) throw new Error("Fake decision failure.");
      return { decision: value, chargedMicroUsd: chargeMicroUsd };
    },
  };
}
