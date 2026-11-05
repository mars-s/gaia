import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { experienceFixture } from "./testing/experiences.ts";

test(
  "experience proposals need exact confirmation and preserve legacy chat",
  { timeout: 15000 },
  async (t) => {
    const f = await experienceFixture(t);
    const old = await (await f.request("state")).json();
    const proposal = await f.propose();
    assert.equal(
      (await f.request(`experiences/${proposal.id}/confirm`, { revision: 0 }))
        .status,
      409,
    );
    assert.equal((await f.state(proposal.id)).scopes.length, 0);
    const confirmed = await f.request(`experiences/${proposal.id}/confirm`, {
      revision: 1,
    });
    assert.equal(confirmed.status, 200);
    assert.equal((await f.state(proposal.id)).scopes.length, 1);
    assert.deepEqual(await (await f.request("state")).json(), old);
  },
);
test(
  "two held independent jobs allow a third answer, atomic replay and scoped Stop",
  { timeout: 20000 },
  async (t) => {
    const f = await experienceFixture(t);
    const state = await f.confirm();
    const profile = state.profile.id,
      scope = state.scopes[0].id;
    const first = f.hold("first"),
      second = f.hold("second");
    f.faux.setResponses([
      fauxAssistantMessage(
        [
          {
            type: "toolCall",
            id: "call-first",
            name: "hold",
            arguments: {
              key: "first",
              description: "Checking the first fixture",
            },
          },
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [
          {
            type: "toolCall",
            id: "call-second",
            name: "hold",
            arguments: {
              key: "second",
              description: "Checking the second fixture",
            },
          },
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Independent third answer"),
    ]);
    const a = await f.send(profile, scope, "First held job");
    await first.started;
    const b = await f.send(profile, scope, "Second held job");
    await second.started;
    const c = await f.send(profile, scope, "Third job");
    const done = await f.settled(profile, c.jobId);
    assert.equal(done.state.kind, "completed");
    if (done.state.kind === "completed")
      assert.equal(done.state.text, "Independent third answer");
    const replay = await f.send(
      profile,
      scope,
      "First held job",
      (await f.scope(profile, scope)).jobs.find((j) => j.id === a.jobId)!
        .requestId,
    );
    assert.equal(replay.jobId, a.jobId);
    const original = (await f.scope(profile, scope)).jobs.find(
      (j) => j.id === a.jobId,
    )!;
    assert.equal(
      (
        await f.request(`experiences/${profile}/scopes/${scope}/messages`, {
          requestId: original.requestId,
          text: "Changed",
        })
      ).status,
      409,
    );
    const stop = await f.request(
      `experiences/${profile}/jobs/${a.jobId}/stop`,
      {},
    );
    assert.equal(stop.status, 200, await stop.clone().text());
    assert.equal(
      (await f.scope(profile, scope)).jobs.find((j) => j.id === b.jobId)?.state
        .kind,
      "running",
    );
    f.faux.setResponses([fauxAssistantMessage("Second completed")]);
    second.release();
    assert.equal((await f.settled(profile, b.jobId)).state.kind, "completed");
    assert.equal((await f.app.busy()).experiences?.jobs, 0);
  },
);

test(
  "subordinate workers finish under saturated parent capacity",
  { timeout: 15000 },
  async (t) => {
    const f = await experienceFixture(t, { concurrency: 1 });
    const s = await f.confirm("bots");
    const p = s.profile.id,
      scope = s.scopes[0].id;
    f.faux.setResponses([
      fauxAssistantMessage(
        [
          {
            type: "toolCall",
            id: "spawn-child",
            name: "spawn_agent",
            arguments: {
              requestId: randomUUID(),
              text: "Child task",
              scopeId: s.scopes[1].id,
              description: "Delegating the fixture check",
            },
          },
        ],
        { stopReason: "toolUse" },
      ),
      (context) => {
        if (
          JSON.stringify(context).includes('"Child task"') &&
          !JSON.stringify(context).includes("spawn-child")
        )
          return fauxAssistantMessage("Actual child answer");
        const text = JSON.stringify(context);
        const match = text.match(/jobId\\?":\\?"([a-f0-9-]{36})/);
        assert(match, text);
        return fauxAssistantMessage(
          [
            {
              type: "toolCall",
              id: "wait-child",
              name: "wait_agent",
              arguments: {
                jobId: match[1],
                description: "Waiting for the fixture check",
              },
            },
          ],
          { stopReason: "toolUse" },
        );
      },
      () => fauxAssistantMessage("Actual child answer"),
      () => fauxAssistantMessage("Parent completed after child"),
    ]);
    const admitted = await f.send(p, scope, "Parent delegates one check");
    const job = await f.settled(p, admitted.jobId);
    assert.equal(job.state.kind, "completed");
    const state = await f.state(p);
    assert.equal(state.jobs.length, 2);
    assert.equal(
      state.jobs.find((job) => job.parentId === admitted.jobId)?.scopeId,
      s.scopes[1].id,
    );
    assert(state.jobs.every((j) => j.state.kind === "completed"));
  },
);

test(
  "images belong to one scope and HTTP policy guards every new route",
  { timeout: 15000 },
  async (t) => {
    const { png } = await import("./testing/experiences.ts");
    const f = await experienceFixture(t);
    const s = await f.confirm("sessions");
    const p = s.profile.id,
      a = s.scopes[0].id,
      b = s.scopes[1].id;
    const id = randomUUID();
    const upload = await f.request(`experiences/${p}/scopes/${a}/attachments`, {
      id,
      name: "fixture.png",
      mimeType: "image/png",
      data: png,
    });
    assert.equal(upload.status, 201, await upload.clone().text());
    assert.equal(
      (await f.request(`experiences/${p}/scopes/${b}/attachments/${id}`))
        .status,
      404,
    );
    assert.equal(
      (
        await f.request(`experiences/${p}/scopes/${b}/messages`, {
          requestId: randomUUID(),
          text: "Other scope",
          attachments: [id],
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await f.request(`experiences/${p}/state`, undefined, {
          Origin: "https://untrusted.invalid",
        })
      ).status,
      403,
    );
    f.allowed = false;
    assert.equal(
      (
        await f.request(`experiences/${p}/scopes/${a}/messages`, {
          requestId: randomUUID(),
          text: "Denied",
        })
      ).status,
      503,
    );
    f.allowed = true;
    f.connected = false;
    assert.equal((await f.request(`experiences/${p}/state`)).status, 409);
  },
);

for (const layout of ["single", "bots", "channels", "sessions"] as const)
  test(
    `${layout} memory uses explicit provenance and correct namespace`,
    { timeout: 15000 },
    async (t) => {
      const f = await experienceFixture(t);
      const s = await f.confirm(layout);
      const p = s.profile.id,
        a = s.scopes[0].id,
        b = s.scopes.at(-1)!.id;
      f.faux.setResponses([
        fauxAssistantMessage(
          [
            {
              type: "toolCall",
              id: "remember",
              name: "remember_fact",
              arguments: {
                key: "fixture-fact",
                value: "SENTINEL_SHARED_732",
                expectedRevision: 0,
                description: "Remembering the explicit fixture fact",
              },
            },
          ],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("Stored explicit fact"),
      ]);
      const first = await f.send(
        p,
        a,
        "Remember this fact. PRIVATE_TRANSCRIPT_419",
      );
      assert.equal((await f.settled(p, first.jobId)).state.kind, "completed");
      f.faux.setResponses([
        (context) => {
          const prompt = JSON.stringify(context);
          assert.equal(
            prompt.includes("SENTINEL_SHARED_732"),
            layout === "single" || layout === "channels",
          );
          if (a !== b) assert(!prompt.includes("PRIVATE_TRANSCRIPT_419"));
          return fauxAssistantMessage("Checked namespace");
        },
      ]);
      const second = await f.send(p, b, "Use permitted memory");
      assert.equal((await f.settled(p, second.jobId)).state.kind, "completed");
      const other = await f.confirm("single");
      f.faux.setResponses([
        (context) => {
          assert(!JSON.stringify(context).includes("SENTINEL_SHARED_732"));
          return fauxAssistantMessage("Other profile is empty");
        },
      ]);
      const third = await f.send(
        other.profile.id,
        other.scopes[0].id,
        "Check memory",
      );
      assert.equal(
        (await f.settled(other.profile.id, third.jobId)).state.kind,
        "completed",
      );
    },
  );

test(
  "quiesce closes admission, joins jobs, and reopening does not replay them",
  { timeout: 15000 },
  async (t) => {
    const f = await experienceFixture(t);
    const s = await f.confirm();
    const p = s.profile.id,
      a = s.scopes[0].id;
    const gate = f.hold("quiesce");
    f.faux.setResponses([
      fauxAssistantMessage(
        [
          {
            type: "toolCall",
            id: "hold-close",
            name: "hold",
            arguments: {
              key: "quiesce",
              description: "Holding the shutdown fixture",
            },
          },
        ],
        { stopReason: "toolUse" },
      ),
    ]);
    const admitted = await f.send(p, a, "Held shutdown");
    await gate.started;
    await f.app.quiesce();
    assert.equal((await f.app.busy()).experiences?.jobs, 0);
    assert.equal(
      (
        await f.request(`experiences/${p}/scopes/${a}/messages`, {
          requestId: randomUUID(),
          text: "Too late",
        })
      ).status,
      503,
    );
    const calls = f.faux.state.callCount;
    await f.reopen();
    assert.equal(f.faux.state.callCount, calls);
    assert.equal((await f.scope(p, a)).jobs.length, 1);
    assert.equal((await f.scope(p, a)).jobs[0].id, admitted.jobId);
  },
);

test(
  "scope compaction uses Pi's summariser and later jobs receive its context",
  { timeout: 15000 },
  async (t) => {
    const f = await experienceFixture(t);
    const s = await f.confirm();
    const p = s.profile.id,
      a = s.scopes[0].id;
    for (let i = 0; i < 3; i++) {
      f.faux.setResponses([
        fauxAssistantMessage(
          "Older fixture answer " + i + " ".repeat(10) + "detail ".repeat(200),
        ),
      ]);
      const admission = await f.send(
        p,
        a,
        "Older request " + i + " detail ".repeat(200),
      );
      assert.equal(
        (await f.settled(p, admission.jobId)).state.kind,
        "completed",
      );
    }
    const calls = f.faux.state.callCount;
    f.faux.setResponses([
      (context) => {
        assert(JSON.stringify(context).includes("Older request"));
        return fauxAssistantMessage("GENUINE_PI_COMPACT_SUMMARY_725");
      },
    ]);
    const response = await f.request(
      `experiences/${p}/scopes/${a}/compact`,
      {},
    );
    assert.equal(response.status, 200, await response.clone().text());
    assert(f.faux.state.callCount > calls);
    f.faux.setResponses([
      (context) => {
        assert(
          JSON.stringify(context).includes("GENUINE_PI_COMPACT_SUMMARY_725"),
        );
        return fauxAssistantMessage("Using compacted context");
      },
    ]);
    const admission = await f.send(p, a, "Read the compacted context");
    assert.equal((await f.settled(p, admission.jobId)).state.kind, "completed");
    const runtime = await f.pi.experiences!.resolve(p);
    const stored = await runtime.read();
    assert.equal(
      stored.scopes[0].ledger.filter((e) => e.kind === "result").length,
      4,
    );
  },
);

test(
  "queued admissions freeze settings and memory revisions",
  { timeout: 15000 },
  async (t) => {
    const f = await experienceFixture(t, { concurrency: 1 });
    const s = await f.confirm();
    const p = s.profile.id,
      a = s.scopes[0].id;
    const held = f.hold("settings");
    f.faux.setResponses([
      fauxAssistantMessage(
        [
          {
            type: "toolCall",
            id: "hold-settings",
            name: "hold",
            arguments: {
              key: "settings",
              description: "Checking frozen configuration",
            },
          },
        ],
        { stopReason: "toolUse" },
      ),
    ]);
    const first = await f.send(p, a, "First request");
    await held.started;
    const second = await f.send(p, a, "Queued request");
    const configured = await f.request(`experiences/${p}/scopes/${a}/model`, {
      modelId: "second",
      thinkingLevel: "low",
    });
    assert.equal(configured.status, 200, await configured.clone().text());
    f.faux.setResponses([
      fauxAssistantMessage("First done"),
      (context, _options, _state, model) => {
        assert.equal(model.id, "gpt-6.1-sol");
        assert(JSON.stringify(context).includes("Queued request"));
        return fauxAssistantMessage("Frozen queued answer");
      },
    ]);
    held.release();
    await f.settled(p, first.jobId);
    assert.equal((await f.settled(p, second.jobId)).state.kind, "completed");
    assert.equal((await f.scope(p, a)).chat.modelId, "second");
  },
);

test(
  "Stop joins a parent's held descendant and contributes one terminal result each",
  { timeout: 15000 },
  async (t) => {
    const f = await experienceFixture(t, { concurrency: 1 });
    const s = await f.confirm();
    const p = s.profile.id,
      a = s.scopes[0].id;
    const held = f.hold("descendant");
    f.faux.setResponses([
      fauxAssistantMessage(
        [
          {
            type: "toolCall",
            id: "spawn-held-child",
            name: "spawn_agent",
            arguments: {
              requestId: randomUUID(),
              text: "Held descendant request",
              description: "Delegating the held fixture",
            },
          },
        ],
        { stopReason: "toolUse" },
      ),
      (context) =>
        JSON.stringify(
          context.messages.findLast((m) => m.role === "user")?.content,
        ).includes("Held descendant request")
          ? fauxAssistantMessage(
              [
                {
                  type: "toolCall",
                  id: "hold-descendant",
                  name: "hold",
                  arguments: {
                    key: "descendant",
                    description: "Checking the descendant fixture",
                  },
                },
              ],
              { stopReason: "toolUse" },
            )
          : fauxAssistantMessage("Parent waits for owned work"),
      (context) =>
        JSON.stringify(
          context.messages.findLast((m) => m.role === "user")?.content,
        ).includes("Held descendant request")
          ? fauxAssistantMessage(
              [
                {
                  type: "toolCall",
                  id: "hold-descendant",
                  name: "hold",
                  arguments: {
                    key: "descendant",
                    description: "Checking the descendant fixture",
                  },
                },
              ],
              { stopReason: "toolUse" },
            )
          : fauxAssistantMessage("Parent waits for owned work"),
    ]);
    const admission = await f.send(p, a, "Parent with owned descendant");
    await held.started;
    const response = await f.request(
      `experiences/${p}/jobs/${admission.jobId}/stop`,
      {},
    );
    assert.equal(response.status, 200, await response.clone().text());
    const runtime = await f.pi.experiences!.resolve(p);
    const state = await runtime.read();
    assert.equal(state.jobs.length, 2);
    assert(
      state.jobs.every(
        (j) => !["queued", "running", "stopping"].includes(j.public.state.kind),
      ),
    );
    assert.equal(
      state.scopes[0].ledger.filter((entry) => entry.kind === "result").length,
      2,
    );
  },
);

test(
  "SSE shows authoritative tool activity and disconnect leaves durable work running",
  { timeout: 15000 },
  async (t) => {
    const f = await experienceFixture(t);
    const s = await f.confirm();
    const p = s.profile.id,
      a = s.scopes[0].id;
    const held = f.hold("events");
    f.faux.setResponses([
      fauxAssistantMessage(
        [
          {
            type: "toolCall",
            id: "events-tool",
            name: "hold",
            arguments: {
              key: "events",
              description: "Inspecting the owned event fixture",
            },
          },
        ],
        { stopReason: "toolUse" },
      ),
    ]);
    const admission = await f.send(p, a, "Event fixture");
    await held.started;
    const response = await f.request(`experiences/${p}/scopes/${a}/events`);
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    let content = "";
    while (!content.includes("Inspecting the owned event fixture")) {
      const part = await reader.read();
      assert(!part.done);
      content += new TextDecoder().decode(part.value);
    }
    const snapshots = content
      .split("\n\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    const job = snapshots
      .at(-1)
      .jobs.find((job: { id: string }) => job.id === admission.jobId);
    assert.equal(job.state.activity[0].callId, "events-tool");
    assert.equal(job.state.activity[0].id, `${admission.jobId}/events-tool`);
    await reader.cancel();
    assert.equal((await f.scope(p, a)).jobs[0].state.kind, "running");
    f.faux.setResponses([fauxAssistantMessage("Result after disconnect")]);
    held.release();
    assert.equal((await f.settled(p, admission.jobId)).state.kind, "completed");
  },
);

test(
  "Pi can propose an experience but only explicit revision confirmation creates scopes",
  { timeout: 15000 },
  async (t) => {
    const f = await experienceFixture(t);
    f.faux.setResponses([
      fauxAssistantMessage(
        [
          {
            type: "toolCall",
            id: "propose-layout",
            name: "propose_experience",
            arguments: {
              layout: "sessions",
              title: "Proposed sessions",
              assistantName: "Gaia",
              purpose: "Explicit fixture request",
              scopes: [{ label: "First session", purpose: "Fixture session" }],
            },
          },
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Review this proposal in the app"),
    ]);
    const response = await f.request("messages", {
      requestId: randomUUID(),
      text: "Propose sessions for review",
    });
    assert.equal(response.status, 202);
    // Legacy server already owns and joins this run on quiesce.
    for (let i = 0; i < 500; i++) {
      const state = await (await f.request("state")).json();
      if (state.thread.run.kind !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const index = await (await f.request("experiences")).json();
    assert.equal(index.profiles.length, 1);
    assert.equal(index.profiles[0].kind, "proposed");
    assert.equal((await f.state(index.profiles[0].id)).scopes.length, 0);
  },
);
