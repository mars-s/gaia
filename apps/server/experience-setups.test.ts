import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, stat, mkdtemp, cp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { compatible } from "../../core/schema.ts";
import { openOwnerProfile } from "./profile.ts";
import { join } from "node:path";
import { experienceFixture } from "./testing/experiences.ts";

test("setup sidecars retain Pi, exact confirmation and deterministic restart order", async (t) => {
  const f = await experienceFixture(t);
  const a = await f.propose();
  const b = await f.propose();
  const path = join(f.dir, "experiences", a.id, "pi.sqlite");
  assert((await stat(path)).isFile());
  const proposal = await readFile(
    join(f.dir, "experiences", a.id, "proposal.json"),
  );
  assert.equal(
    (await stat(join(f.dir, "experiences", a.id, "proposal.json"))).mode &
      0o777,
    0o600,
  );
  const first = await f.request("experiences/" + a.id + "/dismiss", {});
  assert.equal(first.status, 200);
  const dismissed = await first.json();
  assert.deepEqual(
    await (await f.request("experiences/" + a.id + "/dismiss", {})).json(),
    dismissed,
  );
  assert((await stat(path)).isFile());
  assert.equal(
    (
      await f.request("experiences/" + a.id + "/confirm", {
        revision: a.revision + 1,
      })
    ).status,
    409,
  );
  assert.equal((await f.state(a.id)).scopes.length, 0);
  assert.equal(
    (
      await f.request("experiences/" + a.id + "/confirm", {
        revision: a.revision,
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.request("experiences/" + a.id + "/dismiss", {})).status,
    409,
  );
  const before = await (await f.request("experiences")).json();
  await f.reopen();
  const after = await (await f.request("experiences")).json();
  assert.deepEqual(
    after.profiles.map((p: { id: string }) => p.id),
    before.profiles.map((p: { id: string }) => p.id),
  );
  assert.deepEqual(
    after.profiles.map((p: { id: string }) => p.id),
    [a.id, b.id],
  );
  assert(proposal.length > 0);
});

test("only a trusted same-conversation proposal supersedes pending setups", async (t) => {
  const f = await experienceFixture(t);
  const manual = await f.propose();
  const runtime = f.pi.experiences!;
  const create = (conversationId: string) =>
    runtime.create(
      { requestId: randomUUID(), plan: manual.plan },
      {
        source: { kind: "conversation", conversationId },
        answerMessageId: "bound-answer",
      },
    );
  const a = await create("home");
  const other = await create("other");
  const b = await create("home");
  const index = await runtime.index();
  assert.equal(
    index.profiles.find((p) => p.id === a.id)?.proposal?.supersededBy,
    b.id,
  );
  assert.equal(
    index.profiles.find((p) => p.id === other.id)?.proposal?.supersededBy,
    undefined,
  );
  assert.equal(
    index.profiles.find((p) => p.id === manual.id)?.proposal?.supersededBy,
    undefined,
  );
  assert.equal(b.proposal.answerMessageId, "bound-answer");
  assert.equal(
    (
      await f.request("experiences", {
        requestId: randomUUID(),
        plan: manual.plan,
        source: { kind: "conversation", conversationId: "home" },
      })
    ).status,
    400,
  );
});

test("main is explicit, reversible, idempotent and uses the existing mutation guards", async (t) => {
  const f = await experienceFixture(t);
  const proposal = await f.propose();
  const put = (profileId: string | null, headers = {}) =>
    fetch(f.base + "/api/v1/experiences/main", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ profileId }),
    });
  assert.equal((await put(proposal.id)).status, 409);
  await f.request("experiences/" + proposal.id + "/confirm", {
    revision: proposal.revision,
  });
  assert.equal(
    (await (await f.request("experiences/main")).json()).profileId,
    null,
  );
  const selected = await (await put(proposal.id)).json();
  assert.deepEqual(await (await put(proposal.id)).json(), selected);
  assert.equal(
    (await put(null, { origin: "http://untrusted.invalid" })).status,
    403,
  );
  f.allowed = false;
  assert.equal((await put(null)).status, 503);
  f.allowed = true;
  await f.reopen();
  assert.equal(
    (await (await f.request("experiences/main")).json()).profileId,
    proposal.id,
  );
  assert.equal((await put(null)).status, 200);
  assert.equal(
    (await fetch(f.base + "/api/v1/experiences", { method: "PUT" })).status,
    404,
  );
});

test("main sidecars preserve a synthetic 35-message owner and skipped details without provider calls", async (t) => {
  const f = await experienceFixture(t);
  const db = new DatabaseSync(join(f.dir, "gaia.sqlite"));
  t.after(() => db.close());
  const thread = JSON.stringify({
    version: 1,
    id: "local",
    messages: Array.from({ length: 35 }, (_, i) => ({
      id: "synthetic-" + i,
      role: i % 2 ? "assistant" : "user",
      text: "Owned fixture sentinel " + i,
      createdAt: new Date(i * 1000).toISOString(),
    })),
    run: { kind: "idle" },
  });
  db.prepare("INSERT OR REPLACE INTO chat VALUES (1,?)").run(thread);
  openOwnerProfile(db).action("skip");
  await f.reopen();
  const details = await readFile(join(f.dir, "owner-profile.json"));
  const setup = await f.confirm();
  const baseline = await mkdtemp(join(tmpdir(), "gaia-setup-baseline-"));
  t.after(() => rm(baseline, { recursive: true, force: true }));
  await cp(f.dir, baseline, { recursive: true });
  for (const id of await readdir(join(baseline, "experiences")))
    await rm(join(baseline, "experiences", id, "proposal.json"), {
      force: true,
    });
  await compatible(baseline, f.dir);
  const calls = f.faux.state.callCount;
  for (const profileId of [setup.profile.id, null]) {
    const response = await fetch(f.base + "/api/v1/experiences/main", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId }),
    });
    assert.equal(response.status, 200);
    await f.reopen();
    assert.equal(
      db.prepare("SELECT value FROM chat WHERE id=1").get()?.value,
      thread,
    );
    assert.deepEqual(
      await readFile(join(f.dir, "owner-profile.json")),
      details,
    );
    assert.equal(openOwnerProfile(db).read().kind, "skipped");
    assert.equal(f.faux.state.callCount, calls);
    await compatible(baseline, f.dir);
  }
});

test("new setups snapshot the source model and effort, preserving choices after confirmation and restart", async (t) => {
  const f = await experienceFixture(t);
  assert(f.pi.configure);
  await f.pi.configure("second", "low");
  const proposal = await f.propose("bots");
  await f.pi.configure("gpt-6.1-sol", "medium");
  const confirmed = await f.request(`experiences/${proposal.id}/confirm`, { revision: proposal.revision });
  assert.equal(confirmed.status, 200);
  const state = await f.state(proposal.id);
  for (const scope of state.scopes) {
    const chat = (await f.scope(proposal.id, scope.id)).chat;
    assert.equal(chat.modelId, "second");
    assert.equal(chat.thinkingLevel, "low");
  }
  const first = state.scopes[0];
  assert.equal((await f.request(`experiences/${proposal.id}/scopes/${first.id}/model`, { modelId: "gpt-6.1-sol", thinkingLevel: "high" })).status, 200);
  await f.reopen();
  assert.equal((await f.scope(proposal.id, first.id)).chat.thinkingLevel, "high");
  assert.equal((await f.scope(proposal.id, state.scopes[1].id)).chat.thinkingLevel, "low");
  const nested = await f.request("experiences", { requestId: randomUUID(), plan: proposal.plan, selection: { modelId: "gpt-6.1-sol", thinkingLevel: "high" } });
  assert.equal(nested.status, 201);
  const next = await nested.json();
  assert.equal((await f.request(`experiences/${next.id}/confirm`, { revision: next.revision })).status, 200);
  const nextState = await f.state(next.id);
  assert.equal((await f.scope(next.id, nextState.scopes[0].id)).chat.thinkingLevel, "high");
});
