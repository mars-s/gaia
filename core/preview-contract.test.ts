import { test } from "node:test";
import assert from "node:assert/strict";
import { editable, validPath } from "./install.ts";
import { designPack } from "./design/pack.ts";
import { resolve } from "node:path";

test("required-state preview provider is protected and the kit inventory remains readable", async () => {
  const path = "apps/web/ui/preview.tsx";
  assert.equal(editable(path), false);
  assert.throws(() => validPath(path), /Protected/);
  assert.match(await designPack(resolve("."), resolve(".")), /Preview/);
});
