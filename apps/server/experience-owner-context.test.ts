import { test } from "node:test";
import assert from "node:assert/strict";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { experienceFixture } from "./testing/experiences.ts";
import { openDatabase } from "./server.ts";
import { openOwnerProfile } from "./profile.ts";

test("profile jobs receive only confirmed owner preferences at admission", async (t) => {
  const f = await experienceFixture(t);
  const db = await openDatabase(f.dir);
  t.after(() => db.close());
  const owner = openOwnerProfile(db);
  const setup = await f.confirm("bots");
  const prompts: string[] = [];
  async function run(scope = setup.scopes[0].id) {
    f.faux.setResponses([
      (context) => {
        prompts.push(JSON.stringify(context));
        return fauxAssistantMessage("Fixture answer");
      },
    ]);
    const admitted = await f.send(setup.profile.id, scope, "Check fixture");
    assert.equal(
      (await f.settled(setup.profile.id, admitted.jobId)).state.kind,
      "completed",
    );
  }
  await run();
  assert(!prompts.at(-1)?.includes("Confirmed owner context"));
  assert(owner.action("start"));
  owner.propose({
    name: "Synthetic Owner 9402",
    purpose: "Synthetic owner-context proof",
    workingStyle: "agentic",
    approvalPreferences: "Ask before sending any external message 9402",
    lifeAreas: [],
  });
  await run();
  assert(!prompts.at(-1)?.includes("Synthetic Owner 9402"));
  const proposed = owner.read();
  assert.equal(proposed.kind, "proposed");
  if (proposed.kind !== "proposed") throw new Error("Missing proposal");
  assert.equal(
    (await f.request("profile/confirm", { proposalId: proposed.proposalId }))
      .status,
    202,
  );
  await run(setup.scopes[1].id);
  assert.match(prompts.at(-1) ?? "", /Synthetic Owner 9402/);
  assert.match(
    prompts.at(-1) ?? "",
    /Ask before sending any external message 9402/,
  );
  assert.match(prompts.at(-1) ?? "", /Initiative is not blanket permission/);
  assert(owner.action("reset"));
  assert(owner.action("skip"));
  await run();
  assert(!prompts.at(-1)?.includes("Synthetic Owner 9402"));
});

test("confirming owner preferences does not change an already running job", async (t) => {
  const f = await experienceFixture(t);
  const db = await openDatabase(f.dir);
  t.after(() => db.close());
  const owner = openOwnerProfile(db);
  const setup = await f.confirm();
  const held = f.hold("owner-context");
  const prompts: string[] = [];
  f.faux.setResponses([
    (context) => {
      prompts.push(JSON.stringify(context));
      return fauxAssistantMessage(
        [
          {
            type: "toolCall",
            id: "hold-owner-context",
            name: "hold",
            arguments: {
              key: "owner-context",
              description: "Checking the context snapshot",
            },
          },
        ],
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      prompts.push(JSON.stringify(context));
      return fauxAssistantMessage("Finished with admitted context");
    },
  ]);
  const admitted = await f.send(
    setup.profile.id,
    setup.scopes[0].id,
    "Hold this fixture",
  );
  await held.started;
  assert(owner.action("start"));
  owner.propose({
    name: "Later Owner 7301",
    purpose: "Synthetic",
    workingStyle: "balanced",
    lifeAreas: [],
  });
  const proposed = owner.read();
  if (proposed.kind !== "proposed") throw new Error("Missing proposal");
  assert.equal(
    (await f.request("profile/confirm", { proposalId: proposed.proposalId }))
      .status,
    202,
  );
  held.release();
  assert.equal(
    (await f.settled(setup.profile.id, admitted.jobId)).state.kind,
    "completed",
  );
  assert.equal(prompts.length, 2);
  assert(prompts.every((prompt) => !prompt.includes("Later Owner 7301")));
});
