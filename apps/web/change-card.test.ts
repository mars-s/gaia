import { test } from "node:test";
import assert from "node:assert/strict";
import { ManagedChange } from "../../packages/sdk/managed.ts";
import { changesForReply } from "./change-card-model.ts";

test("change cards attach only to their original reply or exact setup scope and omit superseded revisions", () => {
  const base = { id: "08c519e7-e982-45fa-ac70-1fe245b20c77", reason: "Add tasks", at: "2026-11-07", diff: "diff", checks: [], outcome: "accepted", detail: "Applied" };
  const original = ManagedChange.parse({ ...base, source: { kind: "original", answerMessageId: "answer" } });
  const source = { kind: "experience" as const, profileId: "08c519e7-e982-45fa-ac70-1fe245b20c78", scopeId: "08c519e7-e982-45fa-ac70-1fe245b20c79", answerMessageId: "answer" };
  const setup = ManagedChange.parse({ ...base, source });
  const changes = [original, setup, { ...original, detail: "Replaced by a revised proposal." }];
  assert.deepEqual(changesForReply(changes, { kind: "original", answerMessageId: "answer" }), [original]);
  assert.deepEqual(changesForReply(changes, source), [setup]);
  assert.deepEqual(changesForReply(changes, { ...source, scopeId: source.profileId }), []);
  assert.deepEqual(changesForReply(changes, { ...source, answerMessageId: "another-reply" }), []);
  assert.deepEqual(changesForReply([ManagedChange.parse(base)], { kind: "original", answerMessageId: "answer" }), []);
});
