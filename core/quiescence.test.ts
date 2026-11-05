import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, type TestContext } from "node:test";
import { cleanEnv, stop } from "./process.ts";
import { quiesce } from "./quiescence.ts";

const binding = {
  release: "synthetic-release",
  generation: "/synthetic/generation",
};
function fixture(
  t: TestContext,
  mode: "ok" | "no-receipt" | "wrong-generation" | "nonzero" | "hanging",
) {
  const script = `
    const mode = process.argv[1];
    process.on('message', (request) => {
      if (mode === 'hanging') return;
      if (mode === 'no-receipt') return process.exit(0);
      const receipt = {...request, kind: 'gaia.quiesced'};
      if (mode === 'wrong-generation') receipt.generation = '/different/generation';
      process.send(receipt, () => setTimeout(() => process.exit(mode === 'nonzero' ? 23 : 0), 200));
    });
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ["-e", script, mode], {
    detached: true,
    env: cleanEnv(),
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  t.after(() => stop(child));
  return child;
}

test("quiesce requires a matching receipt and actual clean child closure", async (t) => {
  const child = fixture(t, "ok");
  const received = once(child, "message");
  let settled = false;
  const work = quiesce(child, binding, 3000).then((receipt) => {
    settled = true;
    return receipt;
  });
  await received;
  assert.equal(settled, false, "A receipt alone cannot authorise a snapshot.");
  assert.equal(child.exitCode, null);
  const receipt = await work;
  assert.equal(receipt.release, binding.release);
  assert.equal(receipt.generation, binding.generation);
  assert.equal(child.exitCode, 0);
});

test("clean exit without acknowledgement cannot authorise a snapshot", async (t) => {
  const child = fixture(t, "no-receipt");
  await assert.rejects(
    quiesce(child, binding, 3000),
    /without a shutdown receipt/,
  );
  await assert.rejects(quiesce(child, binding, 3000), /IPC is unavailable/);
});

test("a foreign generation receipt and a failed child exit are refused", async (t) => {
  await assert.rejects(
    quiesce(fixture(t, "wrong-generation"), binding, 3000),
    /different generation/,
  );
  await assert.rejects(
    quiesce(fixture(t, "nonzero"), binding, 3000),
    /Managed shutdown failed \(23\)/,
  );
});

test("an unresponsive child's quiesce request has a hard deadline", async (t) => {
  await assert.rejects(
    quiesce(fixture(t, "hanging"), binding, 200),
    /did not finish whole-runtime shutdown/,
  );
});
