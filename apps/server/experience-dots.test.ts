import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { Snapshot } from "../../packages/protocol/index.ts";
import {
  Experience,
  ExperienceScopeState,
  ExperienceState,
} from "../../packages/protocol/experiences.ts";
import { experienceFixture } from "./testing/experiences.ts";
import {
  completed,
  receiptAnswer,
  submissionCall,
  submissionFixture,
  terminal,
  waitForScope,
} from "./testing/dots.ts";

async function centralChat(f: Awaited<ReturnType<typeof experienceFixture>>) {
  const response = await f.request("experiences", {
    requestId: randomUUID(),
    plan: {
      layout: "single",
      title: "Dots acceptance",
      assistantName: "Gaia",
      purpose: "One conversation with independent background submissions",
      scopes: [
        { label: "Conversation", purpose: "Owned local HTTP acceptance" },
      ],
    },
  });
  assert.equal(response.status, 201);
  const proposal = Experience.parse(await response.json());
  assert.equal(proposal.kind, "proposed");
  assert.equal((await f.state(proposal.id)).scopes.length, 0);
  assert.equal(
    (
      await f.request(`experiences/${proposal.id}/confirm`, {
        revision: proposal.revision + 1,
      })
    ).status,
    409,
  );
  assert.equal((await f.state(proposal.id)).scopes.length, 0);
  const confirmation = await f.request(`experiences/${proposal.id}/confirm`, {
    revision: proposal.revision,
  });
  assert.equal(confirmation.status, 200);
  const state = ExperienceState.parse(await confirmation.json());
  assert.equal(state.profile.kind, "ready");
  assert.equal(state.scopes.length, 1);
  const profile = state.profile.id,
    scope = state.scopes[0].id;
  const chat = (await f.scope(profile, scope)).chat;
  assert.equal(chat.modelId, "gpt-6.1-sol");
  assert.equal(chat.thinkingLevel, "medium");
  return { profile, scope };
}

test(
  "Dots central chat returns independent HTTP results while accepting a quick reply, replay and disconnect",
  { timeout: 20000 },
  async (t) => {
    const http = await submissionFixture(t);
    const f = await experienceFixture(t, { extensions: [http.extension] });
    f.faux.setResponses([fauxAssistantMessage("Original legacy answer")]);
    assert.equal(
      (
        await f.request("messages", {
          requestId: randomUUID(),
          text: "Original legacy thread",
        })
      ).status,
      202,
    );
    let legacy = Snapshot.parse(await (await f.request("state")).json());
    for (let i = 0; i < 1000; i++) {
      legacy = Snapshot.parse(await (await f.request("state")).json());
      if (legacy.thread.run.kind !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(legacy.thread.run.kind, "idle");
    assert(JSON.stringify(legacy).includes("Original legacy answer"));
    const { profile, scope } = await centralChat(f);
    const webhookBody = JSON.stringify({
      event: "archive.ready",
      reference: "W-731",
    });
    const formBody = "name=Avi&request=fixture+booking";
    const webhook = http.hold(webhookBody, "Webhook receipt W-731");
    const form = http.hold(formBody, "Form booking F-294");
    f.faux.setResponses([
      submissionCall(
        {
          path: "/webhook",
          body: webhookBody,
          description: "Sending the archive webhook",
        },
        "archive-webhook",
      ),
      submissionCall(
        {
          path: "/form",
          body: formBody,
          description: "Submitting the booking form",
        },
        "booking-form",
      ),
      fauxAssistantMessage("Quick reply while both submissions wait"),
    ]);
    const requestId = randomUUID();
    const first = await f.send(
      profile,
      scope,
      "Send the archive webhook",
      requestId,
    );
    await webhook.arrived;
    const second = await f.send(profile, scope, "Submit the booking form");
    await form.arrived;
    const third = await f.send(profile, scope, "Give me a quick reply");
    completed(
      await terminal(f, profile, scope, third.jobId),
      "Quick reply while both submissions wait",
    );
    assert.deepEqual(http.requests, [
      {
        path: "/webhook",
        method: "POST",
        contentType: "application/json",
        body: webhookBody,
      },
      {
        path: "/form",
        method: "POST",
        contentType: "application/x-www-form-urlencoded",
        body: formBody,
      },
    ]);
    assert.equal(http.effects.length, 0);
    const active = await waitForScope(
      f,
      profile,
      scope,
      (state) =>
        state.jobs.filter(
          (job) => job.state.kind === "running" && job.state.activity.length,
        ).length === 2,
    );
    for (const [id, callId, description] of [
      [first.jobId, "archive-webhook", "Sending the archive webhook"],
      [second.jobId, "booking-form", "Submitting the booking form"],
    ]) {
      const job = active.jobs.find((job) => job.id === id);
      assert(job?.state.kind === "running");
      assert.deepEqual(job.state.activity, [
        { id: `${id}/${callId}`, callId, description, kind: "other" },
      ]);
    }
    const events = await f.request(
      `experiences/${profile}/scopes/${scope}/events`,
    );
    assert.equal(events.status, 200);
    assert(events.body);
    const reader = events.body.getReader();
    let content = "";
    while (!content.includes("Submitting the booking form")) {
      const part = await reader.read();
      assert(!part.done);
      content += new TextDecoder().decode(part.value);
    }
    const snapshot = content
      .split("\n\n")
      .findLast((frame) => frame.startsWith("data: "));
    assert(snapshot);
    const streamed = ExperienceScopeState.parse(JSON.parse(snapshot.slice(6)));
    assert.equal(
      streamed.jobs.filter((job) => job.state.kind === "running").length,
      2,
    );
    await reader.cancel();
    assert.equal(
      (await f.send(profile, scope, "Send the archive webhook", requestId))
        .jobId,
      first.jobId,
    );
    assert.equal(
      (
        await f.request(`experiences/${profile}/scopes/${scope}/messages`, {
          requestId,
          text: "Changed request",
        })
      ).status,
      409,
    );
    assert.equal(http.requests.length, 2);
    f.faux.setResponses([receiptAnswer]);
    form.release();
    completed(
      await terminal(f, profile, scope, second.jobId),
      "HTTP 200: Form booking F-294",
    );
    assert.equal(
      (await f.scope(profile, scope)).jobs.find((job) => job.id === first.jobId)
        ?.state.kind,
      "running",
    );
    assert.deepEqual(
      http.effects.map((effect) => effect.body),
      [formBody],
    );
    f.faux.setResponses([receiptAnswer]);
    webhook.release();
    completed(
      await terminal(f, profile, scope, first.jobId),
      "HTTP 200: Webhook receipt W-731",
    );
    const calls = f.faux.state.callCount;
    assert.equal(
      (await f.send(profile, scope, "Send the archive webhook", requestId))
        .jobId,
      first.jobId,
    );
    const final = await f.scope(profile, scope);
    assert.equal(final.jobs.length, 3);
    for (const [jobId, text] of [
      [first.jobId, "HTTP 200: Webhook receipt W-731"],
      [second.jobId, "HTTP 200: Form booking F-294"],
      [third.jobId, "Quick reply while both submissions wait"],
    ]) {
      const job = final.jobs.find((job) => job.id === jobId);
      assert(job);
      assert.equal(
        final.messages.find((message) => message.id === job.answerId)?.text,
        text,
      );
    }
    assert.equal(f.faux.state.callCount, calls);
    assert.equal(http.requests.length, 2);
    assert.deepEqual(
      http.effects.map((effect) => effect.body),
      [formBody, webhookBody],
    );
    assert.deepEqual(
      Snapshot.parse(await (await f.request("state")).json()),
      legacy,
    );
  },
);

test(
  "Dots scoped Stop aborts only its HTTP request and an independent HTTP failure leaves the other submission running",
  { timeout: 20000 },
  async (t) => {
    const http = await submissionFixture(t);
    const f = await experienceFixture(t, { extensions: [http.extension] });
    const { profile, scope } = await centralChat(f);
    const stopped = http.hold("stop=owned", "Must never commit");
    const survivor = http.hold("survive=owned", "Surviving form receipt");
    const failing = http.hold("fail=owned", "Owned endpoint unavailable", 503);
    f.faux.setResponses([
      submissionCall(
        {
          path: "/webhook",
          body: "stop=owned",
          description: "Sending the cancellable webhook",
        },
        "stop-http",
      ),
      submissionCall(
        {
          path: "/form",
          body: "survive=owned",
          description: "Submitting the independent form",
        },
        "survive-http",
      ),
      submissionCall(
        {
          path: "/webhook",
          body: "fail=owned",
          description: "Checking the unavailable endpoint",
        },
        "fail-http",
      ),
    ]);
    const stopRequestId = randomUUID();
    const a = await f.send(
      profile,
      scope,
      "Send a cancellable webhook",
      stopRequestId,
    );
    await stopped.arrived;
    const b = await f.send(profile, scope, "Submit an independent form");
    await survivor.arrived;
    const c = await f.send(profile, scope, "Call the unavailable endpoint");
    await failing.arrived;
    const stop = await f.request(
      `experiences/${profile}/jobs/${a.jobId}/stop`,
      {},
    );
    assert.equal(stop.status, 200);
    await stopped.disconnected;
    const cancelled = await terminal(f, profile, scope, a.jobId);
    assert.equal(cancelled.state.kind, "uncertain");
    if (cancelled.state.kind === "uncertain")
      assert.equal(cancelled.state.invocationIds.length, 1);
    assert.equal(
      (
        await f.send(
          profile,
          scope,
          "Send a cancellable webhook",
          stopRequestId,
        )
      ).jobId,
      a.jobId,
    );
    assert(!("activity" in cancelled.state));
    assert.equal(
      (await f.scope(profile, scope)).jobs.find((job) => job.id === b.jobId)
        ?.state.kind,
      "running",
    );
    f.faux.setResponses([receiptAnswer]);
    failing.release();
    completed(
      await terminal(f, profile, scope, c.jobId),
      "HTTP 503: Owned endpoint unavailable",
    );
    assert.equal(
      (await f.scope(profile, scope)).jobs.find((job) => job.id === b.jobId)
        ?.state.kind,
      "running",
    );
    assert.equal(http.effects.length, 0);
    f.faux.setResponses([receiptAnswer]);
    survivor.release();
    completed(
      await terminal(f, profile, scope, b.jobId),
      "HTTP 200: Surviving form receipt",
    );
    assert.deepEqual(
      http.effects.map((effect) => effect.body),
      ["survive=owned"],
    );
    assert.equal(http.requests.length, 3);
  },
);
