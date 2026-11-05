import { test } from "node:test";
import assert from "node:assert/strict";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { deferred, experienceFixture } from "./testing/experiences.ts";

test(
  "concurrent profile jobs select only their immutable bound extension and live capabilities",
  { timeout: 15000 },
  async (t) => {
    const release = deferred();
    const bothStarted = deferred();
    const bindings: {
      jobId: string;
      conversationId: number;
      scopeId: string;
    }[] = [];
    let enabled = false;
    t.after(() => release.resolve());
    const f = await experienceFixture(t, {
      capabilities: () => ({ machine: enabled }),
      extensionsForJob(binding) {
        return [
          defineExtension({
            name: `bound-${binding.jobId}`,
            tools: [
              defineTool({
                name: "bound_identity",
                description: "Return this job's immutable identity",
                parameters: {
                  type: "object",
                  properties: {},
                  additionalProperties: false,
                },
                async execute(_input, api) {
                  assert.equal(api.conversationId, binding.conversationId);
                  bindings.push(binding);
                  if (bindings.length === 2) bothStarted.resolve();
                  await release.promise;
                  return {
                    output: [{ type: "text", text: JSON.stringify(binding) }],
                  };
                },
              }),
            ],
          }),
        ];
      },
    });
    const profile = await f.confirm("channels");
    const response = () =>
      fauxAssistantMessage(
        [
          {
            type: "toolCall",
            id: "same-provider-call-id",
            name: "bound_identity",
            arguments: {},
          },
        ],
        { stopReason: "toolUse" },
      );
    f.faux.setResponses([response(), response()]);
    const a = await f.send(
      profile.profile.id,
      profile.scopes[0].id,
      "First bound request",
    );
    const b = await f.send(
      profile.profile.id,
      profile.scopes[1].id,
      "Second bound request",
    );
    await bothStarted.promise;
    assert.deepEqual(
      new Set(bindings.map((x) => x.jobId)),
      new Set([a.jobId, b.jobId]),
    );
    assert.equal(new Set(bindings.map((x) => x.conversationId)).size, 2);
    assert.equal(
      (await f.state(profile.profile.id)).capabilities.machine,
      false,
    );
    enabled = true;
    assert.equal(
      (await f.state(profile.profile.id)).capabilities.machine,
      true,
    );
    assert.equal(
      (await (await f.request("experiences")).json()).capabilities.machine,
      true,
    );
    f.faux.setResponses([
      fauxAssistantMessage("Bound first result"),
      fauxAssistantMessage("Bound second result"),
    ]);
    release.resolve();
    assert.equal(
      (await f.settled(profile.profile.id, a.jobId)).state.kind,
      "completed",
    );
    assert.equal(
      (await f.settled(profile.profile.id, b.jobId)).state.kind,
      "completed",
    );
  },
);
