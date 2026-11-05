import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { experienceFixture } from "./testing/experiences.ts";
import { canSignalOwnedChild } from "./experience-tools/test-support.ts";

async function eventually(check: () => Promise<boolean>) {
  const end = Date.now() + 5000;
  while (!(await check())) {
    assert(Date.now() < end, "Owned process did not reach the expected state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function shell(script: string, cwd: string) {
  return fauxAssistantMessage(
    [
      {
        type: "toolCall",
        id: "same-call-id",
        name: "mac_shell",
        arguments: {
          activity: "Checking the owned local fixture",
          executable: process.execPath,
          args: ["-e", script],
          cwd,
          timeoutMs: 5000,
        },
      },
    ],
    { stopReason: "toolUse" },
  );
}

test(
  "Pi profile jobs execute actual bound Mac tools and keep capability gates live",
  { timeout: 15000 },
  async (t) => {
    if (!(await canSignalOwnedChild()))
      return t.skip("Candidate sandbox denies signalling owned processes.");
    const dir = await mkdtemp(join(tmpdir(), "gaia-host-integration-"));
    let mode: "stable" | "candidate" = "stable";
    const receipts = join(dir, "tool-receipts");
    const f = await experienceFixture(t, {
      directory: dir,
      tools: {
        receiptDirectory: receipts,
        generation: "owned-generation",
        mode: () => mode,
        enabled: () => true,
        platform: "darwin",
      },
    });
    const profile = await f.confirm("channels");
    const p = profile.profile.id;
    const program = (key: string) =>
      `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(join(dir, key))},'started');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(join(dir, "release"))})){clearInterval(timer);process.stdout.write(${JSON.stringify(key + "-actual-result")});}},10);`;
    f.faux.setResponses([shell(program("a"), dir), shell(program("b"), dir)]);
    const a = await f.send(p, profile.scopes[0].id, "First actual command");
    await eventually(async () => (await readdir(dir)).includes("a"));
    const b = await f.send(p, profile.scopes[1].id, "Second actual command");
    await eventually(async () => (await readdir(dir)).includes("b"));
    assert.equal((await f.app.busy()).experiences?.jobs, 2);
    assert.equal((await f.state(p)).capabilities.machine, true);
    mode = "candidate";
    assert.equal((await f.state(p)).capabilities.machine, false);
    mode = "stable";
    f.faux.setResponses([
      fauxAssistantMessage("First real command settled"),
      fauxAssistantMessage("Second real command settled"),
    ]);
    await writeFile(join(dir, "release"), "go");
    assert.equal((await f.settled(p, a.jobId)).state.kind, "completed");
    assert.equal((await f.settled(p, b.jobId)).state.kind, "completed");
    const records = await Promise.all(
      (await readdir(receipts))
        .filter((file) => file.endsWith(".json"))
        .map(async (file) =>
          JSON.parse(await readFile(join(receipts, file), "utf8")),
        ),
    );
    assert.deepEqual(
      new Set(records.map((r) => r.identity.jobId)),
      new Set([a.jobId, b.jobId]),
    );
    assert.equal(
      new Set(records.map((r) => r.identity.conversationId)).size,
      2,
    );
    assert(records.every((r) => r.state === "completed"));
    assert(
      records.some((r) => JSON.stringify(r.result).includes("a-actual-result")),
    );
    assert(
      records.some((r) => JSON.stringify(r.result).includes("b-actual-result")),
    );
  },
);

test(
  "a gated native call has a known failure receipt rather than an uncertain effect",
  { timeout: 10000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "gaia-gated-host-"));
    const f = await experienceFixture(t, {
      directory: dir,
      tools: {
        receiptDirectory: join(dir, "receipts"),
        generation: "fixture",
        mode: "candidate",
        enabled: () => true,
        platform: "darwin",
      },
    });
    const s = await f.confirm();
    f.faux.setResponses([
      shell(`require('node:fs').writeFileSync('must-not-exist','bad')`, dir),
      fauxAssistantMessage("Machine tools are temporarily unavailable"),
    ]);
    const admitted = await f.send(
      s.profile.id,
      s.scopes[0].id,
      "Try a gated command",
    );
    const result = await f.settled(s.profile.id, admitted.jobId);
    assert.equal(result.state.kind, "completed");
    assert(!(await readdir(dir)).includes("must-not-exist"));
    const records = await readdir(join(dir, "receipts"));
    assert.equal(records.length, 1);
    const receipt = JSON.parse(
      await readFile(join(dir, "receipts", records[0]), "utf8"),
    );
    assert.equal(receipt.state, "failed");
    assert.match(receipt.message, /disabled/);
  },
);

test(
  "Original chat gets a request-bound host tool and retains normal provider history",
  { timeout: 10000 },
  async (t) => {
    if (!(await canSignalOwnedChild()))
      return t.skip("Candidate sandbox denies signalling owned processes.");
    const dir = await mkdtemp(join(tmpdir(), "gaia-original-host-"));
    const f = await experienceFixture(t, {
      directory: dir,
      tools: {
        receiptDirectory: join(dir, "receipts"),
        generation: "fixture",
        mode: "stable",
        enabled: () => true,
        platform: "darwin",
      },
    });
    f.faux.setResponses([
      shell(`process.stdout.write('ORIGINAL-HOST-735')`, dir),
      fauxAssistantMessage("Original tool completed"),
    ]);
    const requestId = crypto.randomUUID();
    const reply = await f.request("messages", {
      requestId,
      text: "Use the local fixture",
    });
    assert.equal(reply.status, 202, await reply.clone().text());
    await eventually(
      async () =>
        (await (await f.request("state")).json()).thread.run.kind !== "running",
    );
    const state = await (await f.request("state")).json();
    assert.equal(state.thread.messages.at(-1).text, "Original tool completed");
    const records = await readdir(join(dir, "receipts"));
    assert.equal(records.length, 1);
    const receipt = JSON.parse(
      await readFile(join(dir, "receipts", records[0]), "utf8"),
    );
    assert.equal(receipt.identity.jobId, requestId);
    assert.equal(receipt.state, "completed");
    assert(JSON.stringify(receipt.result).includes("ORIGINAL-HOST-735"));
  },
);

test(
  "server quiesce joins an actual profile command before returning",
  { timeout: 10000 },
  async (t) => {
    if (!(await canSignalOwnedChild()))
      return t.skip("Candidate sandbox denies signalling owned processes.");
    const dir = await mkdtemp(join(tmpdir(), "gaia-host-close-"));
    const f = await experienceFixture(t, {
      directory: dir,
      tools: {
        receiptDirectory: join(dir, "receipts"),
        generation: "fixture",
        mode: "stable",
        enabled: () => true,
        platform: "darwin",
      },
    });
    const s = await f.confirm();
    const marker = join(dir, "pid");
    f.faux.setResponses([
      shell(
        `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},100);`,
        dir,
      ),
    ]);
    const admitted = await f.send(
      s.profile.id,
      s.scopes[0].id,
      "Start an owned command for shutdown",
    );
    await eventually(async () => (await readdir(dir)).includes("pid"));
    const pid = Number(await readFile(marker, "utf8"));
    process.kill(pid, 0);
    await f.app.quiesce();
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    const state = await f.scope(s.profile.id, s.scopes[0].id);
    assert.equal(
      state.jobs.find((job) => job.id === admitted.jobId)?.state.kind,
      "uncertain",
    );
    const [name] = await readdir(join(dir, "receipts"));
    const receipt = JSON.parse(
      await readFile(join(dir, "receipts", name), "utf8"),
    );
    assert.equal(receipt.state, "cancelled");
    assert.equal(receipt.result.details.stage, "cancelled");
  },
);
