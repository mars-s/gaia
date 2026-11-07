import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("web source keeps curly apostrophes in contractions and possessives", () => {
 function scan(dir: string) {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
   const path = join(dir, entry.name);
   if (entry.isDirectory()) scan(path);
   else if (/\.tsx?$/.test(path) && !path.includes(".test.")) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /[A-Za-z]'[A-Za-z]/, path);
   }
  }
 }
 scan(new URL("../../apps/web/", import.meta.url).pathname);
});
