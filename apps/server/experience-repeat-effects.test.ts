import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxResponseFactory,
} from "@earendil-works/pi-ai";
import {
  ExperienceJob,
  ExperienceRetry,
} from "../../packages/protocol/experiences.ts";
import { experienceFixture, deferred } from "./testing/experiences.ts";
import { canSignalOwnedChild } from "./experience-tools/test-support.ts";

for (const scenario of [
  "completed",
  "exit1",
  "stopped",
  "before-spawn",
  "spawn-error",
  "search-failed",
] as const) {
  test(
    `repeat guard preserves honest ${scenario} outcomes`,
    { timeout: 15000 },
    async (t) => {
      if (!(await canSignalOwnedChild()))
        return t.skip("Candidate sandbox denies signalling owned processes.");
      const dir = await mkdtemp(join(tmpdir(), "gaia-repeat-effects-"));
      const marker = join(dir, "effects");
      const f = await experienceFixture(t, {
        directory: dir,
        tools: {
          receiptDirectory: join(dir, "receipts"),
          generation: "fixture",
          mode: "stable",
          enabled: () => scenario !== "before-spawn",
          platform: "darwin",
        },
      });
      const s = await f.confirm();
      const p = s.profile.id,
        scope = s.scopes[0].id;
      const began = deferred();
      f.faux.setResponses([
        fauxAssistantMessage(
          [
            fauxToolCall(
              scenario === "search-failed" ? "search_web" : "mac_shell",
              scenario === "search-failed"
                ? {
                    activity: "Searching the owned fixture",
                    query: "fixture",
                  }
                : {
                    activity: "Writing the owned fixture",
                    executable:
                      scenario === "before-spawn" || scenario === "spawn-error"
                        ? join(dir, "missing")
                        : process.execPath,
                    args: [
                      "-e",
                      `require('node:fs').appendFileSync(${JSON.stringify(marker)},'once\\n');${scenario === "exit1" ? "process.exit(1)" : ""}`,
                    ],
                    cwd: dir,
                  },
              { id: "action" },
            ),
          ],
          { stopReason: "toolUse" },
        ),
        ...(scenario === "search-failed"
          ? Array.from({ length: 10 }, () =>
              fauxAssistantMessage("", {
                stopReason: "error",
                errorMessage: "Owned search failure",
              }),
            )
          : [
              async (
                _context: Parameters<FauxResponseFactory>[0],
                _options: Parameters<FauxResponseFactory>[1],
              ) => {
                began.resolve();
                if (scenario === "stopped") {
                  return fauxAssistantMessage(
                    "Partial model text after the append. ".repeat(20000),
                  );
                }
                return fauxAssistantMessage("Finished");
              },
            ]),
      ]);
      const admission = await f.send(p, scope, "Owned fixture action");
      if (scenario === "stopped") {
        await began.promise;
        const runtime = await f.pi.experiences!.resolve(p);
        const until = Date.now() + 8000;
        while (
          !(await runtime!.read()).jobs.find(
            (j) => j.public.id === admission.jobId,
          )?.partialText
        ) {
          assert(Date.now() < until, "Model text did not stream after append");
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(
          (await f.request(`experiences/${p}/jobs/${admission.jobId}/stop`, {}))
            .status,
          200,
        );
      }
      const job = await f.settled(p, admission.jobId);
      assert.equal(
        job.state.kind,
        scenario === "stopped"
          ? "stopped"
          : scenario === "search-failed"
            ? "failed"
            : "completed",
      );
      const effect =
        scenario !== "before-spawn" &&
        scenario !== "spawn-error" &&
        scenario !== "search-failed";
      assert.equal(job.dispatchedEffect, effect ? true : undefined);
      if (effect) assert.equal(await readFile(marker, "utf8"), "once\n");
      f.faux.setResponses([fauxAssistantMessage("Explicit retry")]);
      const retry = await f.request(`experiences/${p}/jobs/${job.id}/retry`, {
        requestId: crypto.randomUUID(),
      });
      assert.equal(
        retry.status,
        effect ? 409 : 202,
        await retry.clone().text(),
      );
      if (!effect) await f.settled(p, (await retry.json()).jobId);
      if (effect) assert.equal(await readFile(marker, "utf8"), "once\n");
      const runtime = await f.pi.experiences!.resolve(p);
      const receipt = JSON.parse(
        (await runtime!.read()).jobs.find((j) => j.public.id === job.id)!
          .receipts[0].result,
      ).hostReceipt;
      if (scenario === "exit1") assert.equal(receipt.state, "failed");
      if (scenario === "before-spawn" || scenario === "spawn-error")
        assert.equal(receipt.dispatched, false);
    },
  );
}

test(
  "child effect marks its parent durably before settlement and replay acknowledgement",
  { timeout: 15000 },
  async (t) => {
    if (!(await canSignalOwnedChild()))
      return t.skip("Candidate sandbox denies signalling owned processes.");
    const dir = await mkdtemp(join(tmpdir(), "gaia-parent-repeat-"));
    const marker = join(dir, "effects");
    const release = deferred();
    t.after(() => release.resolve());
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
    const s = await f.confirm("bots");
    const childStarted = deferred();

    const response = (context: unknown) => {
      const text = JSON.stringify(context);
      if (text.includes('"Child effect"') && !text.includes("spawn-child")) {
        if (text.includes('"child-append"'))
          return fauxAssistantMessage("Child finished");
        return fauxAssistantMessage(
          [
            fauxToolCall(
              "mac_shell",
              {
                activity: "Writing the child fixture",
                executable: process.execPath,
                args: [
                  "-e",
                  `require('node:fs').appendFileSync(${JSON.stringify(marker)},'once\\n')`,
                ],
                cwd: dir,
              },
              { id: "child-append" },
            ),
          ],
          { stopReason: "toolUse" },
        );
      }
      return async () => {
        childStarted.resolve();
        await release.promise;
        return fauxAssistantMessage("Parent finished");
      };
    };
    f.faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(
            "spawn_agent",
            {
              requestId: crypto.randomUUID(),
              text: "Child effect",
              scopeId: s.scopes[1].id,
              description: "Delegating the child fixture",
            },
            { id: "spawn-child" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      ...Array.from({ length: 6 }, () => (context: unknown) => {
        const result = response(context);
        return typeof result === "function" ? result() : result;
      }),
    ]);
    const parent = await f.send(
      s.profile.id,
      s.scopes[0].id,
      "Delegate fixture",
    );
    await childStarted.promise;
    const runtime = await f.pi.experiences!.resolve(s.profile.id);
    const until = Date.now() + 8000;
    while (
      !(await runtime!.read()).jobs.find((j) => j.public.id === parent.jobId)
        ?.public.dispatchedEffect ||
      (await readFile(marker, "utf8").catch(() => "")) !== "once\n"
    ) {
      assert(Date.now() < until, "Child effect did not propagate");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(await readFile(marker, "utf8"), "once\n");
    release.resolve();
    const job = await f.settled(s.profile.id, parent.jobId);
    assert.equal(job.state.kind, "completed");
    assert.equal(job.dispatchedEffect, true);
    await f.reopen();
    const retry = await f.request(
      `experiences/${s.profile.id}/jobs/${job.id}/retry`,
      { requestId: crypto.randomUUID() },
    );
    assert.equal(retry.status, 409);
    assert.equal(await readFile(marker, "utf8"), "once\n");
  },
);

test("legacy retry and job schemas remain additive and strict", () => {
  assert.deepEqual(
    ExperienceRetry.parse({ requestId: crypto.randomUUID() }).repeatEffects,
    undefined,
  );
  assert(
    ExperienceRetry.safeParse({
      requestId: crypto.randomUUID(),
      repeatEffects: true,
    }).success,
  );
  assert(
    !ExperienceRetry.safeParse({
      requestId: crypto.randomUUID(),
      repeatEffects: false,
    }).success,
  );
  assert(
    !ExperienceRetry.safeParse({ requestId: crypto.randomUUID(), extra: true })
      .success,
  );
  const legacy = {
    id: crypto.randomUUID(),
    profileId: crypto.randomUUID(),
    scopeId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    messageId: "m",
    answerId: "a",
    title: "Legacy",
    contextRevision: 0,
    state: {
      kind: "completed",
      finishedAt: "now",
      text: "Done",
      citations: [],
    },
  };
  assert.equal(ExperienceJob.parse(legacy).dispatchedEffect, undefined);
  assert.equal(
    ExperienceJob.parse({ ...legacy, dispatchedEffect: true }).dispatchedEffect,
    true,
  );
});

test("unclassified extension execute is conservatively flagged and legacy unflagged jobs retry freely", async (t) => {
  const f = await experienceFixture(t);
  const s = await f.confirm();
  const p = s.profile.id,
    scope = s.scopes[0].id;
  f.faux.setResponses([fauxAssistantMessage("Legacy shaped answer")]);
  const first = await f.send(p, scope, "Plain request");
  const legacy = await f.settled(p, first.jobId);
  assert.equal(legacy.dispatchedEffect, undefined);
  f.faux.setResponses([fauxAssistantMessage("Ordinary retry")]);
  const retry = await f.request(`experiences/${p}/jobs/${legacy.id}/retry`, {
    requestId: crypto.randomUUID(),
  });
  assert.equal(retry.status, 202);
  await f.settled(p, (await retry.json()).jobId);
  const held = f.hold("unclassified");
  f.faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall(
          "hold",
          {
            key: "unclassified",
            description: "Inspecting a read-only sounding extension",
          },
          { id: "read-only-sounding" },
        ),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("Extension completed"),
  ]);
  const admission = await f.send(p, scope, "Enter extension");
  await held.started;
  const runtime = await f.pi.experiences!.resolve(p);
  assert.equal(
    (await runtime!.read()).jobs.find((j) => j.public.id === admission.jobId)
      ?.public.dispatchedEffect,
    true,
  );
  held.release();
  const job = await f.settled(p, admission.jobId);
  assert.equal(job.state.kind, "completed");
  const denied = await f.request(`experiences/${p}/jobs/${job.id}/retry`, {
    requestId: crypto.randomUUID(),
  });
  assert.equal(denied.status, 409);
});
