import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canSignalOwnedChild } from "../apps/server/experience-tools/test-support.ts";

test("native lifecycle capability is available outside the candidate sandbox", async () => {
  assert.equal(await canSignalOwnedChild(), true);
});

test(
  "native capability refuses a sandbox that allows signals but denies process-group inspection",
  { skip: process.platform !== "darwin" },
  () => {
    const output = execFileSync(
      "/usr/bin/sandbox-exec",
      [
        "-p",
        '(version 1)(allow default)(deny process-exec (literal "/bin/ps"))',
        process.execPath,
        "--import",
        resolve("node_modules/tsx/dist/loader.mjs"),
        "--input-type=module",
        "-e",
        `import {canSignalOwnedChild} from ${JSON.stringify(pathToFileURL(resolve("apps/server/experience-tools/test-support.ts")).href)}; console.log(await canSignalOwnedChild());`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(output.trim(), "false");
  },
);
