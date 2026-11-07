import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { renderCandidate, renderProfile } from "./render/index.ts";
import { command } from "./process.ts";
import { freePort } from "./sandbox.ts";
import { z } from "zod";

test("the real protected renderer captures all baseline variants hidden with fixture-only data", { skip: process.platform !== "darwin", timeout: 180000 }, async () => {
  const { scratch, results } = await renderCandidate({ stage: resolve("."), core: resolve("."), dependencies: resolve("node_modules") });
  try {
    const reports = z.array(z.object({ shots: z.array(z.object({ file: z.string(), width: z.number(), theme: z.string() })), externalBlocked: z.literal(true), hidden: z.literal(true), errors: z.array(z.string()) })).parse(results);
    assert.equal(reports.length, 5); assert.equal(reports.flatMap(report => report.shots).length, 20);
    for (const [index, scenario] of ["empty", "answer", "proposal", "setups", "failed"].entries()) {
      assert.deepEqual(reports[index].errors, []);
      for (const shot of reports[index].shots) assert((await readFile(join(scratch, scenario, shot.file))).length > 1000);
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
test("the renderer fails closed on an invalid sandbox and its profile cannot grant outside writes", { skip: process.platform !== "darwin" }, async () => {
  const data = await mkdtemp("/private/tmp/gaia-render-policy-");
  try {
    await mkdir(join(data, ".sandbox-profiles"));
    // Production generation runs real denied-read, denied-policy-write and denied-network proofs before returning.
    const { policy, trusted } = await renderProfile(resolve("."), resolve("."), resolve("node_modules"), data, await freePort());
    try {
      const text = await readFile(policy, "utf8");
      assert.doesNotMatch(text, /localhost:\*/); assert.match(text, /\(deny default\)/);
      await writeFile(policy, "INVALID_SANDBOX_PROFILE");
      await assert.rejects(command("/usr/bin/sandbox-exec", ["-f", policy, process.execPath, "-e", "process.exit(0)"], data), /failed/);
    } finally { await rm(trusted, { recursive: true, force: true }); }
  } finally { await rm(data, { recursive: true, force: true }); }
});
