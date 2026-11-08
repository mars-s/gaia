import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Command } from "./state.ts";
import { selfChangeTools } from "./tools.ts";

test("preview command carries only its identity, with manifests defining surfaces", () => {
  const input = { kind: "preview", id: randomUUID() };
  assert.deepEqual(Command.parse(input), input);
  assert.deepEqual(
    Command.parse({ ...input, surfaces: [{ name: "injected", steps: [] }] }),
    input,
  );
});

test("core tool description does not promise app-managed design-pack attachment", () => {
  assert.doesNotMatch(
    JSON.stringify(selfChangeTools("unused")),
    /first UI read or stage in each turn automatically includes it/,
  );
});
