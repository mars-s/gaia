import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import {
  Experience,
  ExperienceState,
  ExperienceScope,
  ExperienceJob,
} from "../../packages/protocol/experiences.ts";
import { experienceFixture } from "./testing/experiences.ts";

const botPlans = [
  { label: "Home", purpose: "Coordinate selected tasks across Bots" },
  { label: "Study", purpose: "Plan university revision" },
  { label: "Work", purpose: "Prepare work reports" },
];
async function setup(f: Awaited<ReturnType<typeof experienceFixture>>) {
  const response = await f.request("experiences", {
    requestId: randomUUID(),
    plan: {
      layout: "bots",
      title: "Grokbot acceptance",
      assistantName: "Gaia",
      purpose: "Separate life areas",
      scopes: botPlans,
    },
  });
  assert.equal(response.status, 201);
  return Experience.parse(await response.json());
}
function call(name: string, args: Record<string, string | number> = {}) {
  return fauxAssistantMessage(
    [{ type: "toolCall", id: randomUUID(), name, arguments: args }],
    { stopReason: "toolUse" },
  );
}
function result(context: unknown, toolName: string): unknown {
  const parsed = z
    .object({
      messages: z.array(
        z.object({
          role: z.string(),
          toolName: z.string().optional(),
          content: z.unknown(),
        }),
      ),
    })
    .parse(context);
  const message = parsed.messages.findLast(
    (m) => m.role === "toolResult" && m.toolName === toolName,
  );
  assert(message, `Missing actual ${toolName} result`);
  const content = z
    .array(z.object({ type: z.string(), text: z.string().optional() }))
    .parse(message.content);
  return JSON.parse(content.map((c) => c.text ?? "").join(""));
}

test(
  "Bots require exact owner confirmation and allocate sourced avatars to new scopes",
  { timeout: 15000 },
  async (t) => {
    const f = await experienceFixture(t);
    const legacy = await (await f.request("state")).json();
    const proposal = await setup(f);
    assert.equal(
      (
        await f.request(`experiences/${proposal.id}/confirm`, {
          revision: proposal.revision + 1,
        })
      ).status,
      409,
    );
    assert.equal((await f.state(proposal.id)).scopes.length, 0);
    assert.equal(
      (
        await f.request(
          `experiences/${proposal.id}/scopes/${randomUUID()}/messages`,
          { requestId: randomUUID(), text: "yes" },
        )
      ).status,
      409,
    );
    const response = await f.request(`experiences/${proposal.id}/confirm`, {
      revision: proposal.revision,
    });
    assert.equal(response.status, 200);
    const state = ExperienceState.parse(await response.json());
    assert.deepEqual(
      state.scopes.map(({ label, purpose }) => ({ label, purpose })),
      botPlans,
    );
    const scopes = [...state.scopes];
    for (const label of ["Garden", "Health", "Travel", "Finance", "Music"]) {
      const added = await f.request(`experiences/${proposal.id}/scopes`, {
        label,
        purpose: `Plan ${label.toLowerCase()}`,
      });
      assert.equal(added.status, 201);
      scopes.push(ExperienceScope.parse(await added.json()));
    }
    assert.equal(new Set(scopes.map((scope) => scope.avatar)).size, 8);
    const provenance = z
      .object({
        assets: z.array(
          z.object({
            file: z.string(),
            licence: z.string(),
            sha256: z.string(),
          }),
        ),
      })
      .parse(
        JSON.parse(
          await readFile("apps/web/public/bots/provenance.json", "utf8"),
        ),
      );
    for (const scope of scopes) {
      const asset = provenance.assets.find(
        (a) => a.file === `${scope.avatar}.svg`,
      );
      assert(asset, `Missing sourced avatar for ${scope.label}`);
      assert.equal(asset.licence, "CC0-1.0");
      const bytes = await readFile(`apps/web/public/bots/${asset.file}`);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        asset.sha256,
      );
      const view = await f.scope(proposal.id, scope.id);
      assert.equal(view.chat.modelId, "gpt-6.1-sol");
      assert.equal(view.chat.thinkingLevel, "medium");
    }
    assert.deepEqual(await (await f.request("state")).json(), legacy);
    const extra = ExperienceScope.parse(
      await (
        await f.request(`experiences/${proposal.id}/scopes`, {
          label: "Extra",
          purpose: "Overflow avatar",
        })
      ).json(),
    );
    assert(scopes.some((scope) => scope.avatar === extra.avatar));
    const chosen = ExperienceScope.parse(
      await (
        await f.request(`experiences/${proposal.id}/scopes`, {
          label: "Chosen",
          purpose: "Explicit avatar",
          avatar: "bot-07",
        })
      ).json(),
    );
    assert.equal(chosen.avatar, "bot-07");
    await f.reopen();
    assert.deepEqual((await f.state(proposal.id)).scopes, [
      ...scopes,
      extra,
      chosen,
    ]);
  },
);

test(
  "Home discovers Study through real scope results and joins actual isolated subordinate work",
  { timeout: 20000 },
  async (t) => {
    const f = await experienceFixture(t, { concurrency: 1 });
    const proposal = await setup(f);
    const confirmed = await f.request(`experiences/${proposal.id}/confirm`, {
      revision: proposal.revision,
    });
    const s = ExperienceState.parse(await confirmed.json());
    const [home, study, work] = s.scopes;
    const p = proposal.id;
    for (const scope of [study, work]) {
      f.faux.setResponses([
        (context) => {
          const prompt = JSON.stringify(context);
          assert(prompt.includes(scope.purpose));
          assert(
            !prompt.includes(scope === study ? work.purpose : study.purpose),
          );
          return call("remember_fact", {
            key: "plan",
            value: `${scope.label}_MEMORY`,
            expectedRevision: 0,
            description: "Remembering the selected plan",
          });
        },
        fauxAssistantMessage(`${scope.label} fact saved`),
      ]);
      const job = await f.send(
        p,
        scope.id,
        `Remember my plan. ${scope.label}_PRIVATE`,
      );
      assert.equal((await f.settled(p, job.jobId)).state.kind, "completed");
    }
    f.faux.setResponses([
      call("read_memory"),
      (context) => {
        const facts = z
          .array(
            z.object({ scopeId: ExperienceScope.shape.id, value: z.string() }),
          )
          .parse(result(context, "read_memory"));
        assert.equal(facts.length, 1);
        assert.equal(facts[0].scopeId, work.id);
        assert.equal(facts[0].value, "Work_MEMORY");
        assert(!JSON.stringify(context).includes("Study_MEMORY"));
        assert(!JSON.stringify(context).includes("Study_PRIVATE"));
        return fauxAssistantMessage("Work checked its own explicit memory");
      },
    ]);
    const memoryCheck = await f.send(p, work.id, "Read my saved work plan");
    assert.equal(
      (await f.settled(p, memoryCheck.jobId)).state.kind,
      "completed",
    );
    const workBefore = await f.scope(p, work.id);
    const studyJobIds = (await f.scope(p, study.id)).jobs.map((job) => job.id);
    const foreign = await f.confirm("bots");
    const foreignScope = foreign.scopes[0];
    let discovered = false;
    f.faux.setResponses([
      (context) => {
        const prompt = JSON.stringify(context);
        assert(!prompt.includes("Study_PRIVATE"));
        assert(!prompt.includes("Study_MEMORY"));
        assert(!prompt.includes("Work_PRIVATE"));
        assert(!prompt.includes("Work_MEMORY"));
        return call("list_scopes");
      },
      (context) => {
        const metadata = z
          .array(
            z.strictObject({
              id: z.string().uuid(),
              label: z.string(),
              purpose: z.string(),
              avatar: z.string(),
            }),
          )
          .parse(result(context, "list_scopes"));
        assert.deepEqual(
          metadata.map((m) => m.label),
          ["Home", "Study", "Work"],
        );
        assert(!JSON.stringify(metadata).includes(foreignScope.id));
        assert(!JSON.stringify(metadata).includes("_PRIVATE"));
        assert(!JSON.stringify(metadata).includes("_MEMORY"));
        const destination = metadata.find((m) => m.label === "Study");
        assert(destination);
        discovered = true;
        return call("spawn_agent", {
          requestId: randomUUID(),
          scopeId: destination.id,
          text: "Prepare selected revision plan",
          description: "Asking Study to prepare revision",
        });
      },
      ...Array.from({ length: 4 }, () => (context: unknown) => {
        const prompt = JSON.stringify(context);
        if (!prompt.includes('"toolName":"spawn_agent"')) {
          assert(prompt.includes("Study_MEMORY"));
          assert(prompt.includes("Study_PRIVATE"));
          assert(!prompt.includes("Work_PRIVATE"));
          assert(!prompt.includes("Work_MEMORY"));
          if (!prompt.includes('"toolName":"read_memory"'))
            return call("read_memory");
          const facts = z
            .array(
              z.object({
                scopeId: ExperienceScope.shape.id,
                jobId: ExperienceJob.shape.id,
                key: z.string(),
                value: z.string(),
              }),
            )
            .parse(result(context, "read_memory"));
          assert.equal(facts.length, 1);
          assert.equal(facts[0].value, "Study_MEMORY");
          assert.equal(facts[0].scopeId, study.id);
          assert(studyJobIds.includes(facts[0].jobId));
          return fauxAssistantMessage("Revision plan from Study's actual job");
        }
        if (!prompt.includes('"toolName":"wait_agent"')) {
          const child = z
            .object({ jobId: z.string().uuid() })
            .parse(result(context, "spawn_agent"));
          return call("wait_agent", {
            jobId: child.jobId,
            description: "Waiting for Study's revision plan",
          });
        }
        const child = ExperienceJob.parse(result(context, "wait_agent"));
        assert.equal(child.state.kind, "completed");
        assert(child.state.kind === "completed");
        assert.equal(child.state.text, "Revision plan from Study's actual job");
        return fauxAssistantMessage(`Home received: ${child.state.text}`);
      }),
    ]);
    const parent = await f.send(
      p,
      home.id,
      "Ask the appropriate Bot to prepare revision",
    );
    const done = await f.settled(p, parent.jobId);
    assert(discovered);
    assert.equal(done.state.kind, "completed", JSON.stringify(done));
    assert(done.state.kind === "completed");
    assert.equal(
      done.state.text,
      "Home received: Revision plan from Study's actual job",
    );
    const state = await f.state(p);
    const child = state.jobs.find((j) => j.parentId === parent.jobId);
    assert(child);
    assert.equal(child.scopeId, study.id);
    assert.equal(child.profileId, p);
    assert.deepEqual((await f.scope(p, work.id)).jobs, workBefore.jobs);
    assert.deepEqual((await f.scope(p, work.id)).messages, workBefore.messages);
    assert(
      !(await f.scope(p, work.id)).messages.some((m) =>
        m.text.includes("revision"),
      ),
    );
    assert.equal((await f.scope(p, home.id)).memoryRevision, 0);
    assert.equal(
      (await f.scope(foreign.profile.id, foreignScope.id)).messages.length,
      0,
    );
  },
);

test(
  "Home Stop joins its discovered Study child and cannot stop an unrelated Work job",
  { timeout: 20000 },
  async (t) => {
    const f = await experienceFixture(t, { concurrency: 2 });
    const proposal = await setup(f);
    const response = await f.request(`experiences/${proposal.id}/confirm`, {
      revision: proposal.revision,
    });
    const s = ExperienceState.parse(await response.json());
    const [home, study, work] = s.scopes;
    const p = proposal.id;
    const workGate = f.hold("work");
    const childGate = f.hold("study");
    f.faux.setResponses([
      call("hold", {
        key: "work",
        description: "Preparing the independent work report",
      }),
    ]);
    const unrelated = await f.send(p, work.id, "Independent work report");
    await workGate.started;
    const { deferred } = await import("./testing/experiences.ts");
    const rejected = deferred();
    f.faux.setResponses([
      call("list_scopes"),
      (context) => {
        const scopes = z
          .array(
            ExperienceScope.pick({
              id: true,
              label: true,
              purpose: true,
              avatar: true,
            }),
          )
          .parse(result(context, "list_scopes"));
        const destination = scopes.find((scope) => scope.label === "Study");
        assert(destination);
        return call("spawn_agent", {
          requestId: randomUUID(),
          scopeId: destination.id,
          text: "Held revision task",
          description: "Asking Study to check revision",
        });
      },
      ...Array.from({ length: 4 }, () => (context: unknown) => {
        const prompt = JSON.stringify(context);
        if (!prompt.includes('"toolName":"spawn_agent"'))
          return call("hold", {
            key: "study",
            description: "Checking the revision fixture",
          });
        if (!prompt.includes('"toolName":"stop_agent"'))
          return call("stop_agent", {
            jobId: unrelated.jobId,
            description: "Checking subordinate ownership",
          });
        assert(prompt.includes("Unknown subordinate job"));
        rejected.resolve();
        const child = z
          .object({ jobId: z.string().uuid() })
          .parse(result(context, "spawn_agent"));
        return call("wait_agent", {
          jobId: child.jobId,
          description: "Waiting for the revision check",
        });
      }),
    ]);
    const parent = await f.send(p, home.id, "Coordinate a held revision task");
    await Promise.all([childGate.started, rejected.promise]);
    const stopped = await f.request(
      `experiences/${p}/jobs/${parent.jobId}/stop`,
      {},
    );
    assert.equal(stopped.status, 200);
    assert.equal(
      ExperienceJob.parse(await stopped.json()).state.kind,
      "stopped",
    );
    const state = await f.state(p);
    const children = state.jobs.filter((j) => j.parentId === parent.jobId);
    assert.equal(children.length, 1);
    assert.equal(children[0].scopeId, study.id);
    assert.equal(children[0].state.kind, "uncertain");
    assert(children[0].state.kind === "uncertain");
    assert.equal(children[0].state.invocationIds.length, 1);
    assert.equal(
      state.jobs.find((j) => j.id === unrelated.jobId)?.state.kind,
      "running",
    );
    f.faux.setResponses([
      fauxAssistantMessage("Independent work report finished"),
    ]);
    workGate.release();
    assert.equal((await f.settled(p, unrelated.jobId)).state.kind, "completed");
    assert.equal((await f.app.busy()).experiences?.jobs, 0);
  },
);

test(
  "Home discovery retains the eight-child bound and joins all admitted Study jobs",
  { timeout: 20000 },
  async (t) => {
    const f = await experienceFixture(t, { concurrency: 1 });
    const proposal = await setup(f);
    const s = ExperienceState.parse(
      await (
        await f.request(`experiences/${proposal.id}/confirm`, {
          revision: proposal.revision,
        })
      ).json(),
    );
    const [home, study] = s.scopes;
    let limitObserved = false;
    f.faux.setResponses([
      call("list_scopes"),
      (context) => {
        const scopes = z
          .array(
            ExperienceScope.pick({
              id: true,
              label: true,
              purpose: true,
              avatar: true,
            }),
          )
          .parse(result(context, "list_scopes"));
        const destination = scopes.find((scope) => scope.label === "Study");
        assert(destination);
        return fauxAssistantMessage(
          Array.from({ length: 9 }, () => ({
            type: "toolCall" as const,
            id: randomUUID(),
            name: "spawn_agent",
            arguments: {
              requestId: randomUUID(),
              scopeId: destination.id,
              text: "Bounded revision task",
              description: "Asking Study to check a revision item",
            },
          })),
          { stopReason: "toolUse" },
        );
      },
      ...Array.from({ length: 9 }, () => (context: unknown) => {
        if (JSON.stringify(context).includes('"toolName":"spawn_agent"')) {
          assert(JSON.stringify(context).includes("Subordinate limit reached"));
          limitObserved = true;
          return fauxAssistantMessage("Joined the bounded revision tasks");
        }
        return fauxAssistantMessage("Revision item checked");
      }),
    ]);
    const parent = await f.send(
      proposal.id,
      home.id,
      "Coordinate bounded revision checks",
    );
    assert.equal(
      (await f.settled(proposal.id, parent.jobId)).state.kind,
      "completed",
    );
    assert(limitObserved);
    const state = await f.state(proposal.id);
    const children = state.jobs.filter((job) => job.parentId === parent.jobId);
    assert.equal(children.length, 8);
    assert(
      children.every(
        (job) => job.scopeId === study.id && job.state.kind === "completed",
      ),
    );
    assert.equal(state.jobs.length, 9);
    assert.equal((await f.app.busy()).experiences?.jobs, 0);
  },
);
