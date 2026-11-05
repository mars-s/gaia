import { canSignalOwnedChild } from "./experience-tools/test-support.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createExperienceToolHost } from "./experience-tools/index.ts";
import { experienceFixture, deferred } from "./testing/experiences.ts";

async function eventually(check: () => Promise<boolean>) {
  const until = Date.now() + 8000;
  while (!(await check())) {
    assert(Date.now() < until, "Fixture did not reach its expected state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

for (const tool of ["mac_shell", "agent_desktop"] as const) {
  for (const action of [
    "timeout",
    "stop",
    "host-quiesce",
    "quiesce",
    "shutdown",
  ] as const) {
    test(
      `${tool} scratch-file effect remains review-required after ${action}`,
      { timeout: 15000 },
      async (t) => {
        if (!(await canSignalOwnedChild()))
          return t.skip("Candidate sandbox denies signalling owned processes.");
        const dir = await mkdtemp(join(tmpdir(), "gaia-effect-certainty-"));
        const receipts = join(dir, "receipts");
        const marker = join(dir, "effects");
        const program = `const fs=require('node:fs');process.stdout.write('effect-written',()=>{fs.appendFileSync(${JSON.stringify(marker)},String(process.pid)+'\\n');});setInterval(()=>{},100);`;
        const desktopExecutable = join(dir, "desktop-fixture");
        await writeFile(desktopExecutable, `#!${process.execPath}\n${program}`);
        await chmod(desktopExecutable, 0o700);
        const host = await createExperienceToolHost({
          receiptDirectory: receipts,
          generation: "fixture",
          mode: "stable",
          enabled: () => true,
          platform: "darwin",
          desktopExecutable,
        });
        t.after(() => host.close());
        const f = await experienceFixture(t, {
          directory: dir,
          extensionsForJob: (binding) => [
            host.extension({ ...binding, generation: "fixture" }),
          ],
        });
        const s = await f.confirm();
        const profile = s.profile.id;
        const scope = s.scopes[0].id;
        f.faux.setResponses([
          fauxAssistantMessage(
            [
              fauxToolCall(
                tool,
                {
                  activity: "Writing the owned fixture and waiting",
                  ...(tool === "mac_shell"
                    ? { executable: process.execPath, args: ["-e", program] }
                    : { args: ["fixture"] }),
                  cwd: dir,
                  timeoutMs: action === "timeout" ? 1800 : 10000,
                },
                { id: "effect" },
              ),
            ],
            { stopReason: "toolUse" },
          ),
          fauxAssistantMessage("The command stopped"),
        ]);
        const admitted = await f.send(profile, scope, "Write once then hold");
        await eventually(async () => (await readdir(dir)).includes("effects"));
        const pid = Number((await readFile(marker, "utf8")).trim());
        if (action === "stop") {
          const response = await f.request(
            `experiences/${profile}/jobs/${admitted.jobId}/stop`,
            {},
          );
          assert.equal(response.status, 200, await response.text());
        } else if (action === "host-quiesce") await host.quiesce();
        else if (action === "quiesce") await f.app.quiesce();
        else if (action === "shutdown") await f.reopen();
        const job = await f.settled(profile, admitted.jobId);
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
        assert.equal(job.state.kind, "uncertain");
        const [name] = await readdir(receipts);
        const receipt = JSON.parse(
          await readFile(join(receipts, name), "utf8"),
        );
        assert.equal(receipt.state, "unknown");
        assert.match(JSON.stringify(receipt.result), /effect-written/);
        assert.match(JSON.stringify(receipt.result), /timeout|cancelled/);
        if (action === "quiesce") await f.reopen();
        const retry = await f.request(
          `experiences/${profile}/jobs/${admitted.jobId}/retry`,
          { requestId: crypto.randomUUID() },
        );
        assert.equal(retry.status, 409, await retry.text());
        assert.equal(
          (await readFile(marker, "utf8")).trim().split("\n").length,
          1,
        );
      },
    );
  }
}

test(
  "hosted read-only search Stop is retryable without effect acknowledgement",
  { timeout: 15000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "gaia-read-cancellation-"));
    const f = await experienceFixture(t, {
      directory: dir,
      tools: {
        receiptDirectory: join(dir, "receipts"),
        generation: "fixture",
        mode: "stable",
        enabled: () => true,
      },
    });
    const s = await f.confirm();
    const began = deferred();
    f.faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(
            "search_web",
            { activity: "Checking owned search evidence", query: "fixture" },
            { id: "read" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      async (_context, options) => {
        began.resolve();
        await new Promise<void>((resolve) => {
          if (options?.signal?.aborted) resolve();
          else
            options?.signal?.addEventListener("abort", () => resolve(), {
              once: true,
            });
        });
        return fauxAssistantMessage("", { stopReason: "aborted" });
      },
    ]);
    const job = await f.send(s.profile.id, s.scopes[0].id, "Search then wait");
    await began.promise;
    const stop = await f.request(
      `experiences/${s.profile.id}/jobs/${job.jobId}/stop`,
      {},
    );
    assert.equal(stop.status, 200);
    assert.equal(
      (await f.settled(s.profile.id, job.jobId)).state.kind,
      "stopped",
    );
    f.faux.setResponses([fauxAssistantMessage("Explicit read retry")]);
    const retry = await f.request(
      `experiences/${s.profile.id}/jobs/${job.jobId}/retry`,
      { requestId: crypto.randomUUID() },
    );
    assert.equal(retry.status, 202, await retry.clone().text());
    await f.settled(s.profile.id, (await retry.json()).jobId);
  },
);

test(
  "probe: a completed effect followed by provider failure can repeat on ordinary retry",
  { timeout: 15000 },
  async (t) => {
    if (!(await canSignalOwnedChild()))
      return t.skip("Candidate sandbox denies signalling owned processes.");
    const dir = await mkdtemp(join(tmpdir(), "gaia-known-effect-retry-"));
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
    const marker = join(dir, "effects");
    const effect = () =>
      fauxAssistantMessage(
        [
          fauxToolCall(
            "mac_shell",
            {
              activity: "Writing the owned retry fixture",
              executable: process.execPath,
              args: [
                "-e",
                `require('node:fs').appendFileSync(${JSON.stringify(marker)},'once\\n')`,
              ],
              cwd: dir,
            },
            { id: "known-effect" },
          ),
        ],
        { stopReason: "toolUse" },
      );
    f.faux.setResponses([
      effect(),
      ...Array.from({ length: 10 }, () =>
        fauxAssistantMessage("", {
          stopReason: "error",
          errorMessage: "Owned provider failure",
        }),
      ),
    ]);
    const job = await f.send(s.profile.id, s.scopes[0].id, "Write fixture");
    assert.equal(
      (await f.settled(s.profile.id, job.jobId)).state.kind,
      "failed",
    );
    assert.equal(await readFile(marker, "utf8"), "once\n");
    f.faux.setResponses([effect(), fauxAssistantMessage("Retry finished")]);
    const retry = await f.request(
      `experiences/${s.profile.id}/jobs/${job.jobId}/retry`,
      { requestId: crypto.randomUUID() },
    );
    assert.equal(retry.status, 202, await retry.clone().text());
    await f.settled(s.profile.id, (await retry.json()).jobId);
    assert.equal(await readFile(marker, "utf8"), "once\nonce\n");
  },
);

test(
  "desktop cancellation while queued does not dispatch a second effect",
  { timeout: 15000 },
  async (t) => {
    if (!(await canSignalOwnedChild()))
      return t.skip("Candidate sandbox denies signalling owned processes.");
    const dir = await mkdtemp(join(tmpdir(), "gaia-desktop-queued-"));
    const executable = join(dir, "desktop-fixture");
    const marker = join(dir, "effects");
    await writeFile(
      executable,
      `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(marker)},'once\\n');setInterval(()=>{},100);`,
    );
    await chmod(executable, 0o700);
    const host = await createExperienceToolHost({
      receiptDirectory: join(dir, "receipts"),
      generation: "fixture",
      mode: "stable",
      enabled: () => true,
      platform: "darwin",
      desktopExecutable: executable,
    });
    t.after(() => host.close());
    const f = await experienceFixture(t, {
      directory: dir,
      extensionsForJob: (binding) => [
        host.extension({ ...binding, generation: "fixture" }),
      ],
    });
    const s = await f.confirm("channels");
    const command = () =>
      fauxAssistantMessage(
        [
          fauxToolCall(
            "agent_desktop",
            {
              activity: "Waiting for the owned desktop",
              cwd: dir,
              args: ["fixture"],
            },
            { id: "desktop" },
          ),
        ],
        { stopReason: "toolUse" },
      );
    f.faux.setResponses([
      command(),
      command(),
      fauxAssistantMessage("Stopped"),
      fauxAssistantMessage("Cancelled before dispatch"),
    ]);
    const first = await f.send(s.profile.id, s.scopes[0].id, "Hold desktop");
    await eventually(async () => (await readdir(dir)).includes("effects"));
    const second = await f.send(s.profile.id, s.scopes[1].id, "Queue desktop");
    await eventually(async () => host.activeInvocationCount === 2);
    await host.quiesce();
    await f.settled(s.profile.id, first.jobId);
    await f.settled(s.profile.id, second.jobId);
    const queued = host
      .receipts()
      .find((receipt) => receipt.identity.jobId === second.jobId);
    assert.equal(queued?.state, "cancelled");
    assert.equal(queued?.dispatched, false);
    assert.equal(await readFile(marker, "utf8"), "once\n");
  },
);

test(
  "a provider cannot silently dispatch a second effect after an unknown outcome",
  { timeout: 15000 },
  async (t) => {
    if (!(await canSignalOwnedChild()))
      return t.skip("Candidate sandbox denies signalling owned processes.");
    const dir = await mkdtemp(join(tmpdir(), "gaia-no-silent-effect-"));
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
    const marker = join(dir, "effects");
    const command = (id: string) =>
      fauxAssistantMessage(
        [
          fauxToolCall(
            "mac_shell",
            {
              activity: "Writing the owned repeat fixture",
              executable: process.execPath,
              args: [
                "-e",
                `require('node:fs').appendFileSync(${JSON.stringify(marker)},'once\\n');setInterval(()=>{},100);`,
              ],
              cwd: dir,
              timeoutMs: 1800,
            },
            { id },
          ),
        ],
        { stopReason: "toolUse" },
      );
    f.faux.setResponses([
      command("first"),
      command("silent-repeat"),
      fauxAssistantMessage("Review required"),
    ]);
    const job = await f.send(s.profile.id, s.scopes[0].id, "Write and wait");
    assert.equal(
      (await f.settled(s.profile.id, job.jobId)).state.kind,
      "uncertain",
    );
    assert.equal(await readFile(marker, "utf8"), "once\n");
    const runtime = await f.pi.experiences?.resolve(s.profile.id);
    assert(runtime);
    const stored = await runtime.read();
    assert.equal(stored.jobs[0].invocations.length, 1);
    assert.equal(stored.jobs[0].receipts.length, 2);
    assert.match(stored.jobs[0].receipts[0].result, /unknown/);
    assert.match(
      stored.jobs[0].receipts[1].result,
      /Review the unknown effect/,
    );
  },
);

test(
  "host-quiesced read-only search is interrupted and retryable",
  { timeout: 15000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "gaia-read-quiesce-"));
    const host = await createExperienceToolHost({
      receiptDirectory: join(dir, "receipts"),
      generation: "fixture",
      mode: "stable",
      enabled: () => true,
    });
    t.after(() => host.close());
    const f = await experienceFixture(t, {
      directory: dir,
      extensionsForJob: (binding) => [
        host.extension({ ...binding, generation: "fixture" }),
      ],
    });
    const s = await f.confirm();
    const began = deferred();
    f.faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(
            "search_web",
            { activity: "Checking owned search evidence", query: "fixture" },
            { id: "read" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      async (_context, options) => {
        began.resolve();
        await new Promise<void>((resolve) => {
          if (options?.signal?.aborted) resolve();
          else
            options?.signal?.addEventListener("abort", () => resolve(), {
              once: true,
            });
        });
        return fauxAssistantMessage("", { stopReason: "aborted" });
      },
      fauxAssistantMessage("The read was interrupted"),
    ]);
    const job = await f.send(s.profile.id, s.scopes[0].id, "Search then wait");
    await began.promise;
    await host.quiesce();
    assert.equal(
      (await f.settled(s.profile.id, job.jobId)).state.kind,
      "interrupted",
    );
    f.faux.setResponses([fauxAssistantMessage("Explicit read retry")]);
    const retry = await f.request(
      `experiences/${s.profile.id}/jobs/${job.jobId}/retry`,
      { requestId: crypto.randomUUID() },
    );
    assert.equal(retry.status, 202, await retry.clone().text());
    await f.settled(s.profile.id, (await retry.json()).jobId);
  },
);
