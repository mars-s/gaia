import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { ExperienceScopeState } from "../../packages/protocol/experiences.ts";
import { experienceFixture } from "./testing/experiences.ts";

for (const ending of ["complete", "stop", "close", "fail"] as const)
  test(
    `public scoped feed shows interim text during a held tool and retains one answer on ${ending}`,
    { timeout: 15000 },
    async (t) => {
      const f = await experienceFixture(t);
      const s = await f.confirm();
      const p = s.profile.id,
        scope = s.scopes[0].id;
      const held = f.hold("progress");
      const acknowledgement =
        "I am checking the fixture now. " + "Fixture detail. ".repeat(300);
      f.faux.setResponses([
        fauxAssistantMessage(
          [
            { type: "text", text: acknowledgement },
            {
              type: "toolCall",
              id: "held-progress",
              name: "hold",
              arguments: {
                key: "progress",
                description: "Checking the held fixture",
              },
            },
          ],
          { stopReason: "toolUse" },
        ),
      ]);
      const runtime = await f.pi.experiences!.resolve(p);
      let publications = 0;
      const unsubscribe = runtime.subscribe(() => publications++);
      t.after(unsubscribe);
      const admitted = await f.send(p, scope, "Check the temporary fixture");
      await held.started;
      let during = await f.scope(p, scope);
      const answerId = during.jobs.find(
        (job) => job.id === admitted.jobId,
      )!.answerId;
      for (
        let i = 0;
        i < 100 &&
        during.messages.find((m) => m.id === answerId)?.text !==
          acknowledgement;
        i++
      ) {
        await delay(10);
        during = await f.scope(p, scope);
      }
      const answer = during.messages.find((m) => m.id === answerId);
      t.diagnostic(
        `during text length ${answer?.text.length}, expected ${acknowledgement.length}, suffix ${answer?.text.slice(-60)}`,
      );
      assert(answer);
      assert(answer.text.startsWith("I am checking the fixture now."));
      const interimText = answer.text;
      const events = await f.request(`experiences/${p}/scopes/${scope}/events`);
      assert.equal(events.status, 200);
      const reader = events.body!.getReader();
      let event = "";
      while (!event.includes("\n\n")) {
        const chunk = await reader.read();
        assert(!chunk.done);
        event += new TextDecoder().decode(chunk.value);
      }
      await reader.cancel();
      const data = event.split("\n").find((line) => line.startsWith("data: "))!;
      const snapshot = ExperienceScopeState.parse(JSON.parse(data.slice(6)));
      assert.equal(
        snapshot.messages.find((m) => m.id === answerId)?.text,
        interimText,
      );

      assert.equal(
        during.messages.filter((m) => m.role === "assistant").length,
        1,
      );
      const job = during.jobs.find((j) => j.id === admitted.jobId)!;
      assert.equal(job.state.kind, "running");
      if (job.state.kind === "running")
        assert.equal(
          job.state.activity[0]?.description,
          "Checking the held fixture",
        );
      t.diagnostic(
        `publications before held-tool release: ${publications}; acknowledgement characters: ${acknowledgement.length}`,
      );
      if (ending === "complete") {
        f.faux.setResponses([
          fauxAssistantMessage("The fixture check is complete."),
        ]);
        held.release();
        const final = await f.settled(p, admitted.jobId);
        assert.equal(final.state.kind, "completed");
      } else if (ending === "fail") {
        f.faux.setResponses([
          () => {
            throw new Error("Fixture provider failure");
          },
        ]);
        held.release();
        assert.equal((await f.settled(p, admitted.jobId)).state.kind, "failed");
      } else if (ending === "stop") {
        assert.equal(
          (await f.request(`experiences/${p}/jobs/${admitted.jobId}/stop`, {}))
            .status,
          200,
        );
        await f.settled(p, admitted.jobId);
      } else {
        await f.reopen();
      }
      const after = await f.scope(p, scope);
      assert.equal(
        after.messages.filter((m) => m.role === "assistant").length,
        1,
      );
      assert.equal(
        after.messages.find((m) => m.id === answerId)?.text,
        ending === "complete" ? "The fixture check is complete." : interimText,
      );
      assert(
        !["running", "stopping", "queued"].includes(after.jobs[0].state.kind),
      );
    },
  );

test("text projection limits a 100-update second to five writes including the trailing value", async (t) => {
  const { textProjection } = await import("./experiences/text-projection.ts");
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const writes: string[] = [];
  const errors: unknown[] = [];
  const projection = textProjection(
    async (text) => {
      writes.push(text);
    },
    (error) => errors.push(error),
  );
  for (let i = 0; i < 100; i++) {
    projection.update(String(i));
    t.mock.timers.tick(10);
  }
  await projection.finish();
  assert.equal(writes.length, 5);
  assert.equal(writes.at(-1), "99");
  projection.update("late callback");
  t.mock.timers.tick(1000);
  await projection.finish();
  assert.equal(writes.length, 5);
  assert.deepEqual(errors, []);
});

test("finish cancels the timer, writes the exact final text, and joins in-flight storage", async (t) => {
  const { textProjection } = await import("./experiences/text-projection.ts");
  const { deferred } = await import("./testing/experiences.ts");
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const gate = deferred();
  const writes: string[] = [];
  const projection = textProjection(
    async (text) => {
      await gate.promise;
      writes.push(text);
    },
    (error) => {
      throw error;
    },
  );
  projection.update("First");
  projection.update("Exact final text");
  let joined = false;
  const finishing = projection.finish().then(() => {
    joined = true;
  });
  await Promise.resolve();
  assert.equal(joined, false);
  gate.resolve();
  await finishing;
  assert.deepEqual(writes, ["First", "Exact final text"]);
  t.mock.timers.tick(1000);
  assert.deepEqual(writes, ["First", "Exact final text"]);
});

test("projection storage errors reach the abort handler and pending writes are joined", async () => {
  const { textProjection } = await import("./experiences/text-projection.ts");
  const error = new Error("Fixture storage failure");
  const errors: unknown[] = [];
  const projection = textProjection(
    async () => {
      throw error;
    },
    (error) => errors.push(error),
  );
  projection.update("First");
  projection.update("Pending");
  await projection.finish();
  assert.deepEqual(errors, [error]);
});

test("repeated identical text does not publish again", async (t) => {
  const { textProjection } = await import("./experiences/text-projection.ts");
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const writes: string[] = [];
  const projection = textProjection(
    async (text) => {
      writes.push(text);
    },
    (error) => {
      throw error;
    },
  );
  projection.update("Same text");
  t.mock.timers.tick(250);
  projection.update("Same text");
  await projection.finish();
  assert.deepEqual(writes, ["Same text"]);
});
