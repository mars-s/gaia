import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { TestContext } from "node:test";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { fauxAssistantMessage, type Context } from "@earendil-works/pi-ai";
import { z } from "zod";
import {
  ExperienceJob,
  ExperienceScopeState,
} from "../../../packages/protocol/experiences.ts";
import { deferred, experienceFixture } from "./experiences.ts";

const Submission = z.object({
  path: z.enum(["/webhook", "/form"]),
  body: z.string(),
  description: z.string(),
});

type Receipt = {
  path: string;
  method: string | undefined;
  contentType: string | undefined;
  body: string;
};

export async function submissionFixture(t: TestContext) {
  const requests: Receipt[] = [];
  const effects: Receipt[] = [];
  const gates = new Map<
    string,
    {
      arrived: ReturnType<typeof deferred>;
      release: ReturnType<typeof deferred>;
      disconnected: ReturnType<typeof deferred>;
      status: number;
      result: string;
    }
  >();
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const receipt = {
      path: request.url ?? "",
      method: request.method,
      contentType: request.headers["content-type"],
      body: Buffer.concat(chunks).toString(),
    };
    requests.push(receipt);
    const gate = gates.get(receipt.body);
    assert(gate, "Only explicitly arranged submissions are allowed");
    response.on("close", () => gate.disconnected.resolve());
    gate.arrived.resolve();
    await Promise.race([gate.release.promise, gate.disconnected.promise]);
    if (response.destroyed) return;
    if (gate.status < 400) effects.push(receipt);
    response.writeHead(gate.status, { "Content-Type": "text/plain" });
    response.end(gate.result);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    for (const gate of gates.values()) gate.release.resolve();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const extension = defineExtension({
    name: "owned-http-submissions",
    tools: [
      defineTool({
        name: "submit_owned_http",
        description: "Submit to the owned loopback webhook or form fixture",
        parameters: z.toJSONSchema(Submission),
        async execute(raw, api, ctx) {
          const input = Submission.parse(raw);
          await api.details(
            { kind: "other", description: input.description },
            ctx,
          );
          const response = await fetch(base + input.path, {
            method: "POST",
            headers: {
              "Content-Type":
                input.path === "/form"
                  ? "application/x-www-form-urlencoded"
                  : "application/json",
            },
            body: input.body,
            signal: ctx.abortSignal,
          });
          const text = await response.text();
          return {
            output: [
              {
                type: "text",
                text: JSON.stringify({ status: response.status, text }),
              },
            ],
          };
        },
      }),
    ],
  });
  return {
    extension,
    requests,
    effects,
    hold(body: string, result: string, status = 200) {
      const gate = {
        arrived: deferred(),
        release: deferred(),
        disconnected: deferred(),
        status,
        result,
      };
      gates.set(body, gate);
      return {
        arrived: gate.arrived.promise,
        release: gate.release.resolve,
        disconnected: gate.disconnected.promise,
      };
    },
  };
}

export function submissionCall(input: z.infer<typeof Submission>, id: string) {
  return fauxAssistantMessage(
    [
      {
        type: "toolCall",
        id,
        name: "submit_owned_http",
        arguments: input,
      },
    ],
    { stopReason: "toolUse" },
  );
}

export function receiptAnswer(context: Context) {
  const result = context.messages.findLast(
    (message) => message.role === "toolResult",
  );
  assert(
    result?.role === "toolResult",
    "The answer must consume an actual tool result",
  );
  const text = result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  const receipt = z
    .object({ status: z.number(), text: z.string() })
    .parse(JSON.parse(text));
  return fauxAssistantMessage(`HTTP ${receipt.status}: ${receipt.text}`);
}

export type Fixture = Awaited<ReturnType<typeof experienceFixture>>;

export async function waitForScope(
  f: Fixture,
  profile: string,
  scope: string,
  accept: (state: ExperienceScopeState) => boolean,
) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const state = await f.scope(profile, scope);
    if (accept(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for public scope state");
}

export async function terminal(
  f: Fixture,
  profile: string,
  scope: string,
  jobId: string,
) {
  const state = await waitForScope(f, profile, scope, (state) => {
    const job = state.jobs.find((job) => job.id === jobId);
    return !!job && !["queued", "running", "stopping"].includes(job.state.kind);
  });
  const job = state.jobs.find((job) => job.id === jobId);
  assert(job);
  return job;
}

export function completed(job: ExperienceJob, text: string) {
  assert.equal(job.state.kind, "completed");
  if (job.state.kind === "completed") assert.equal(job.state.text, text);
  assert(!("activity" in job.state), "Settled jobs must clear active progress");
}
