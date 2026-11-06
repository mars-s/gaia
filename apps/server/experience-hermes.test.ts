import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { ExperienceScope } from "../../packages/protocol/experiences.ts";
import { experienceFixture } from "./testing/experiences.ts";

async function completed(
  f: Awaited<ReturnType<typeof experienceFixture>>,
  profile: string,
  scope: string,
  jobId: string,
) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const state = await f.scope(profile, scope);
    const job = state.jobs.find((item) => item.id === jobId);
    if (job && !["queued", "running", "stopping"].includes(job.state.kind)) {
      assert.equal(job.state.kind, "completed", JSON.stringify(job.state));
      return state;
    }
    await setTimeout(10);
  }
  assert.fail("Session job did not settle through the public API");
}

test(
  "Hermes sessions retain history, scope model and effort, and reopen without replay",
  { timeout: 20000 },
  async (t) => {
    const f = await experienceFixture(t);
    const legacy = await (await f.request("state")).json();
    const profile = await f.confirm("sessions");
    const p = profile.profile.id;
    const first = profile.scopes[0].id;
    const initial = await f.scope(p, first);
    assert.equal(initial.chat.modelId, "gpt-6.1-sol");
    assert.equal(initial.chat.thinkingLevel, "medium");
    f.faux.setResponses([fauxAssistantMessage("FIRST_SESSION_801")]);
    const admission = await f.send(p, first, "Remember first session");
    const history = await completed(f, p, first, admission.jobId);
    assert(JSON.stringify(history.messages).includes("FIRST_SESSION_801"));

    const response = await f.request(`experiences/${p}/scopes`, {
      label: "New session",
      purpose: "Independent work",
    });
    assert.equal(response.status, 201);
    const fresh = ExperienceScope.parse(await response.json());
    assert((await f.state(p)).scopes.some((item) => item.id === first));
    assert.deepEqual((await f.scope(p, fresh.id)).messages, []);
    assert.deepEqual((await f.scope(p, first)).messages, history.messages);
    const model = await f.request(`experiences/${p}/scopes/${fresh.id}/model`, {
      modelId: "second",
      thinkingLevel: "low",
    });
    assert.equal(model.status, 200);
    f.faux.setResponses([
      (context, options, _state, selectedModel) => {
        assert.equal(selectedModel.id, "second");
        assert.equal(options?.reasoning, "low");
        assert(!JSON.stringify(context).includes("FIRST_SESSION_801"));
        return fauxAssistantMessage("NEW_SESSION_802");
      },
    ]);
    const next = await f.send(p, fresh.id, "Read this session only");
    const freshHistory = await completed(f, p, fresh.id, next.jobId);
    assert(JSON.stringify(freshHistory.messages).includes("NEW_SESSION_802"));
    assert.equal((await f.scope(p, first)).chat.modelId, "gpt-6.1-sol");
    assert.equal((await f.scope(p, first)).chat.thinkingLevel, "medium");
    const calls = f.faux.state.callCount;
    await f.reopen();
    assert.deepEqual((await f.scope(p, first)).messages, history.messages);
    assert.deepEqual(
      (await f.scope(p, fresh.id)).messages,
      freshHistory.messages,
    );
    assert.equal((await f.scope(p, fresh.id)).chat.modelId, "second");
    assert.equal((await f.scope(p, fresh.id)).chat.thinkingLevel, "low");
    assert.equal(f.faux.state.callCount, calls);
    assert.deepEqual(await (await f.request("state")).json(), legacy);
  },
);

test(
  "Hermes compaction uses actual Pi context and preserves both session histories after restart",
  { timeout: 20000 },
  async (t) => {
    const f = await experienceFixture(t);
    const profile = await f.confirm("sessions");
    const p = profile.profile.id;
    const [first, other] = profile.scopes;
    for (let i = 0; i < 3; i++) {
      f.faux.setResponses([
        fauxAssistantMessage(`SESSION_DETAIL_${i} ` + "detail ".repeat(200)),
      ]);
      const job = await f.send(
        p,
        first.id,
        `Earlier request ${i} ` + "detail ".repeat(200),
      );
      await completed(f, p, first.id, job.jobId);
    }
    const history = await f.scope(p, first.id);
    const untouched = await f.scope(p, other.id);
    const calls = f.faux.state.callCount;
    f.faux.setResponses([
      (context) => {
        assert(JSON.stringify(context).includes("Earlier request"));
        return fauxAssistantMessage("SESSION_PI_SUMMARY_803");
      },
    ]);
    const compacted = await f.request(
      `experiences/${p}/scopes/${first.id}/compact`,
      {},
    );
    assert.equal(compacted.status, 200, await compacted.clone().text());
    assert(f.faux.state.callCount > calls);
    assert.deepEqual((await f.scope(p, first.id)).messages, history.messages);
    const otherAfter = await f.scope(p, other.id);
    assert.deepEqual(otherAfter.messages, untouched.messages);
    assert.deepEqual(otherAfter.chat, untouched.chat);
    assert.deepEqual(otherAfter.jobs, untouched.jobs);
    assert.equal(otherAfter.memoryRevision, untouched.memoryRevision);
    await f.reopen();
    f.faux.setResponses([
      (context) => {
        assert(JSON.stringify(context).includes("SESSION_PI_SUMMARY_803"));
        return fauxAssistantMessage("Answer from compacted session");
      },
    ]);
    const next = await f.send(p, first.id, "Continue after restart");
    const after = await completed(f, p, first.id, next.jobId);
    assert(
      JSON.stringify(after.messages).includes("Answer from compacted session"),
    );
    assert.deepEqual(
      after.messages.slice(0, history.messages.length),
      history.messages,
    );
    assert.deepEqual((await f.scope(p, other.id)).messages, untouched.messages);
  },
);
