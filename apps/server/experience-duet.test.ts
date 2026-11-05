import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, type Context } from "@earendil-works/pi-ai";
import { z } from "zod";
import { Fact } from "./experiences/state.ts";
import { experienceFixture } from "./testing/experiences.ts";

function tool(
  id: string,
  name: string,
  args: Record<string, string | number> = {},
) {
  return fauxAssistantMessage(
    [{ type: "toolCall", id, name, arguments: args }],
    { stopReason: "toolUse" },
  );
}
function output(context: Context, id: string) {
  const message = context.messages.find(
    (m) => m.role === "toolResult" && m.toolCallId === id,
  );
  assert(message && message.role === "toolResult");
  const text = message.content
    .flatMap((c) => (c.type === "text" ? [c.text] : []))
    .join("");
  return { text, isError: message.isError };
}
function facts(context: Context, id: string) {
  const result = output(context, id);
  assert(!result.isError, result.text);
  return z.array(Fact).parse(JSON.parse(result.text));
}
const remember = (id: string, value: string, expectedRevision: number) =>
  tool(id, "remember_fact", {
    key: "drink",
    value,
    expectedRevision,
    description: "Remembering the requested drink",
  });
const hold = (key: string) =>
  tool(`hold-${key}`, "hold", {
    key,
    description: "Waiting for the other channel",
  });

test(
  "Duet concurrent channels refresh memory after a stale write without importing transcripts",
  { timeout: 20000 },
  async (t) => {
    const f = await experienceFixture(t);
    const state = await f.confirm("channels");
    const p = state.profile.id;
    const [a, b] = state.scopes;
    assert.equal(state.profile.plan.assistantName, "Gaia");
    for (const scope of state.scopes) {
      const live = await f.scope(p, scope.id);
      assert.equal(live.chat.modelId, "gpt-6.1-sol");
      assert.equal(live.chat.thinkingLevel, "high");
    }
    const gateA = f.hold("a"),
      gateB = f.hold("b");
    f.faux.setResponses([hold("a"), hold("b")]);
    const jobA = await f.send(p, a.id, "Remember tea. PRIVATE_CHANNEL_A_381");
    await gateA.started;
    const jobB = await f.send(
      p,
      b.id,
      "Update the drink after the other channel writes",
    );
    await gateB.started;
    assert.equal((await f.scope(p, a.id)).jobs[0].state.kind, "running");
    assert.equal((await f.scope(p, b.id)).jobs[0].state.kind, "running");
    f.faux.setResponses([
      remember("a-write", "SHARED_TEA_391", 0),
      fauxAssistantMessage("PRIVATE_ANSWER_A_382"),
    ]);
    gateA.release();
    assert.equal((await f.settled(p, jobA.jobId)).state.kind, "completed");
    let refreshed: z.infer<typeof Fact>[] = [];
    let updated: z.infer<typeof Fact>[] = [];
    f.faux.setResponses([
      (context, options, _state, model) => {
        assert.equal(model.id, "gpt-6.1-sol");
        assert.equal(options?.reasoning, "high");
        assert(!JSON.stringify(context).includes("SHARED_TEA_391"));
        return remember("stale-write", "coffee", 0);
      },
      (context) => {
        const conflict = output(context, "stale-write");
        assert(conflict.isError);
        assert.match(
          conflict.text,
          /Memory revision changed\. Read it again\./,
        );
        return tool("refresh", "read_memory");
      },
      (context) => {
        refreshed = facts(context, "refresh");
        if (refreshed.length === 0)
          return fauxAssistantMessage("Read returned no facts");
        assert.equal(refreshed[0].value, "SHARED_TEA_391");
        assert.equal(refreshed[0].jobId, jobA.jobId);
        assert.equal(refreshed[0].scopeId, a.id);
        const prompt = JSON.stringify(context);
        assert(!prompt.includes("PRIVATE_CHANNEL_A_381"));
        assert(!prompt.includes("PRIVATE_ANSWER_A_382"));
        return remember("retry-write", "coffee", refreshed.at(-1)!.revision);
      },
      (context) => {
        assert(!output(context, "retry-write").isError);
        return tool("updated", "read_memory");
      },
      (context) => {
        updated = facts(context, "updated");
        assert.deepEqual(updated[0], refreshed[0]);
        assert.equal(updated.length, 2);
        assert.equal(updated[1].value, "coffee");
        assert.equal(updated[1].revision, 2);
        assert.equal(updated[1].jobId, jobB.jobId);
        assert.equal(updated[1].scopeId, b.id);
        return fauxAssistantMessage("Shared drink updated");
      },
    ]);
    gateB.release();
    const completedB = await f.settled(p, jobB.jobId);
    assert.equal(
      completedB.state.kind,
      "completed",
      JSON.stringify(completedB.state),
    );
    assert.equal(
      refreshed.length,
      1,
      "Explicit read must refresh the older channel job",
    );
    assert.equal(updated.length, 2);
    await f.app.quiesce();
    const before = await Promise.all([
      f.state(p),
      f.scope(p, a.id),
      f.scope(p, b.id),
    ]);
    const calls = f.faux.state.callCount;
    await f.reopen();
    assert.equal(f.faux.state.callCount, calls);
    const after = await Promise.all([
      f.state(p),
      f.scope(p, a.id),
      f.scope(p, b.id),
    ]);
    for (const [index, snapshot] of after.entries()) {
      const { revision, ...durable } = snapshot;
      const { revision: previousRevision, ...previousDurable } = before[index];
      assert.equal(revision, previousRevision + 1);
      assert.deepEqual(durable, previousDurable);
    }
    f.faux.setResponses([
      tool("restored", "read_memory"),
      (context) => {
        assert.deepEqual(facts(context, "restored"), updated);
        assert(!JSON.stringify(context).includes("PRIVATE_CHANNEL_A_381"));
        return fauxAssistantMessage("Restored exact facts");
      },
    ]);
    const restored = await f.send(p, b.id, "Read the durable shared facts");
    assert.equal((await f.settled(p, restored.jobId)).state.kind, "completed");
  },
);

test(
  "Duet same-job write then read returns its own explicit fact",
  { timeout: 15000 },
  async (t) => {
    const f = await experienceFixture(t);
    const state = await f.confirm("channels");
    let read: z.infer<typeof Fact>[] = [];
    f.faux.setResponses([
      remember("write", "tea", 0),
      tool("read", "read_memory"),
      (context) => {
        read = facts(context, "read");
        return fauxAssistantMessage("Read my write");
      },
    ]);
    const job = await f.send(
      state.profile.id,
      state.scopes[0].id,
      "Remember tea and read it back",
    );
    assert.equal(
      (await f.settled(state.profile.id, job.jobId)).state.kind,
      "completed",
    );
    assert.equal(read.length, 1);
    assert.equal(read[0].value, "tea");
    assert.equal(read[0].jobId, job.jobId);
  },
);

for (const layout of ["bots", "sessions"] as const) {
  test(
    `Duet memory tools preserve ${layout} namespace and profile isolation`,
    { timeout: 20000 },
    async (t) => {
      const f = await experienceFixture(t);
      const state = await f.confirm(layout);
      const p = state.profile.id;
      const [a, b] = state.scopes;
      let ownA: z.infer<typeof Fact>[] = [];
      f.faux.setResponses([
        remember("a", "PRIVATE_FACT_A_391", 0),
        tool("read-a", "read_memory"),
        (context) => {
          ownA = facts(context, "read-a");
          return fauxAssistantMessage("PRIVATE_RESULT_A_391");
        },
      ]);
      const first = await f.send(
        p,
        a.id,
        "Remember my drink. PRIVATE_INPUT_A_391",
      );
      assert.equal((await f.settled(p, first.jobId)).state.kind, "completed");
      assert.equal(ownA.length, 1);
      assert.equal(ownA[0].jobId, first.jobId);
      let ownB: z.infer<typeof Fact>[] = [];
      f.faux.setResponses([
        tool("empty-b", "read_memory"),
        (context) => {
          assert.deepEqual(facts(context, "empty-b"), []);
          const prompt = JSON.stringify(context);
          for (const privateValue of [
            "PRIVATE_FACT_A_391",
            "PRIVATE_RESULT_A_391",
            "PRIVATE_INPUT_A_391",
          ])
            assert(!prompt.includes(privateValue));
          return remember("b", "PRIVATE_FACT_B_392", 0);
        },
        tool("read-b", "read_memory"),
        (context) => {
          ownB = facts(context, "read-b");
          return fauxAssistantMessage("Stored in separate namespace");
        },
      ]);
      const second = await f.send(p, b.id, "Remember a separate drink");
      assert.equal((await f.settled(p, second.jobId)).state.kind, "completed");
      assert.equal(ownB.length, 1);
      assert.equal(ownB[0].value, "PRIVATE_FACT_B_392");
      assert.equal(ownB[0].jobId, second.jobId);
      assert.equal(ownB[0].revision, 2);
      f.faux.setResponses([
        tool("still-a", "read_memory"),
        (context) => {
          assert.deepEqual(facts(context, "still-a"), ownA);
          assert(!JSON.stringify(context).includes("PRIVATE_FACT_B_392"));
          return fauxAssistantMessage("First namespace is unchanged");
        },
      ]);
      const again = await f.send(p, a.id, "Read my own drink");
      assert.equal((await f.settled(p, again.jobId)).state.kind, "completed");
      const other = await f.confirm("channels");
      f.faux.setResponses([
        tool("other-profile", "read_memory"),
        (context) => {
          assert.deepEqual(facts(context, "other-profile"), []);
          assert(!JSON.stringify(context).includes("PRIVATE_FACT_A_391"));
          assert(!JSON.stringify(context).includes("PRIVATE_FACT_B_392"));
          return fauxAssistantMessage("Other profile starts empty");
        },
      ]);
      const separate = await f.send(
        other.profile.id,
        other.scopes[0].id,
        "Read permitted facts",
      );
      assert.equal(
        (await f.settled(other.profile.id, separate.jobId)).state.kind,
        "completed",
      );
    },
  );
}
