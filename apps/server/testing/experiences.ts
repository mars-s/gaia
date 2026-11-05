import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { fauxProvider } from "@earendil-works/pi-ai";
import {
  defineExtension,
  defineTool,
  type Extension,
} from "@earendil-works/pi-durable";
import { z } from "zod";
import {
  Experience,
  ExperienceState,
  ExperienceScopeState,
  ExperienceAdmission,
  type ExperienceLayout,
} from "../../../packages/protocol/experiences.ts";
import { createAuth } from "../auth.ts";
import { createPi } from "../pi.ts";
import type { ExperienceRuntimeOptions } from "../experiences/runtime.ts";
import { createChatServer, openDatabase } from "../server.ts";
import { deferred, png } from "./workspace.ts";
export { deferred, png };
export async function experienceFixture(
  t: TestContext,
  options: {
    concurrency?: number;
    extensions?: Extension[];
    directory?: string;
    extensionsForJob?: ExperienceRuntimeOptions["extensionsForJob"];
    capabilities?: ExperienceRuntimeOptions["capabilities"];
    tools?: NonNullable<Parameters<typeof createPi>[4]>["tools"];
  } = {},
) {
  const dir =
    options.directory ?? (await mkdtemp(join(tmpdir(), "gaia-experiences-")));
  const faux = fauxProvider({
    provider: "openai-codex",
    models: [
      { id: "gpt-6.1-sol", reasoning: true, input: ["text", "image"] },
      { id: "second", reasoning: true, input: ["text"] },
    ],
    tokensPerSecond: 100000,
  });
  const gates = new Map<string, ReturnType<typeof deferred>>();
  const started = new Map<string, ReturnType<typeof deferred>>();
  const hold = defineExtension({
    name: "fixture-held-tools",
    tools: [
      defineTool({
        name: "hold",
        description: "Hold a fixture operation until released",
        parameters: z.toJSONSchema(
          z.object({ key: z.string(), description: z.string() }),
        ),
        async execute(raw, api, ctx) {
          const input = z
            .object({ key: z.string(), description: z.string() })
            .parse(raw);
          await api.details(
            { description: input.description, kind: "other" },
            ctx,
          );
          const gate = gates.get(input.key);
          if (!gate) throw new Error("Unknown held tool gate");
          started.get(input.key)?.resolve();
          await Promise.race([
            gate.promise,
            new Promise<void>((resolve) => {
              if (ctx.abortSignal!.aborted) resolve();
              else
                ctx.abortSignal!.addEventListener("abort", () => resolve(), {
                  once: true,
                });
            }),
          ]);
          ctx.abortSignal!.throwIfAborted();
          return { output: [{ type: "text", text: "Released " + input.key }] };
        },
      }),
    ],
  });
  let connected = true,
    allowed = true;
  async function open() {
    const db = await openDatabase(dir);
    const auth = createAuth(db);
    faux.models[0].thinkingLevelMap = auth.models.getModel(
      "openai-codex",
      "gpt-6.1-sol",
    )?.thinkingLevelMap;
    auth.models.setProvider(faux.provider);
    const pi = await createPi(
      join(dir, "pi.sqlite"),
      auth,
      [],
      { compaction: { enabled: false, keepRecentTokens: 1 } },
      {
        experiencesEnabled: true,
        tools: options.tools,
        experiences: {
          concurrency: options.concurrency,
          extensionsForJob: options.extensionsForJob,
          capabilities: options.capabilities,
          extensions: [hold, ...(options.extensions ?? [])],
        },
      },
    );
    const origins: string[] = [];
    const app = createChatServer({
      db,
      adapter: pi,
      origins,
      allowWrite: async () => allowed,
      auth: {
        status: () =>
          connected
            ? { kind: "connected", model: "gpt-6.1-sol" }
            : { kind: "disconnected", message: "Connect first" },
        connect() {},
        reply() {},
        close: () => auth.close(),
      },
    });
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    const address = app.server.address();
    assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    origins.push(base);
    return { db, auth, pi, app, base };
  }
  let live = await open();
  let closed = false;
  t.after(async () => {
    if (!closed) await live.app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const request = (
    path: string,
    input?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(live.base + "/api/v1/" + path, {
      method: input === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...headers },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
  const state = async (profile: string) =>
    ExperienceState.parse(
      await (await request(`experiences/${profile}/state`)).json(),
    );
  const scope = async (profile: string, id: string) =>
    ExperienceScopeState.parse(
      await (await request(`experiences/${profile}/scopes/${id}/state`)).json(),
    );
  return {
    dir,
    faux,
    request,
    state,
    scope,
    get app() {
      return live.app;
    },
    get pi() {
      return live.pi;
    },
    get base() {
      return live.base;
    },
    get auth() {
      return live.auth;
    },
    set allowed(value: boolean) {
      allowed = value;
    },
    set connected(value: boolean) {
      connected = value;
    },
    hold(key: string) {
      const gate = deferred(),
        began = deferred();
      gates.set(key, gate);
      started.set(key, began);
      return { started: began.promise, release: gate.resolve };
    },
    async propose(layout: ExperienceLayout = "single") {
      const response = await request("experiences", {
        requestId: randomUUID(),
        plan: {
          layout,
          title: "Fixture " + layout,
          assistantName: "Gaia",
          purpose: "Synthetic fixture",
          scopes:
            layout === "single"
              ? [{ label: "Main", purpose: "Main fixture" }]
              : [
                  { label: "Home", purpose: "Home fixture" },
                  { label: "Other", purpose: "Other fixture" },
                ],
        },
      });
      assert.equal(response.status, 201, await response.clone().text());
      return Experience.parse(await response.json());
    },
    async confirm(layout: ExperienceLayout = "single") {
      const proposal = await this.propose(layout);
      const response = await request(`experiences/${proposal.id}/confirm`, {
        revision: proposal.revision,
      });
      assert.equal(response.status, 200, await response.clone().text());
      return ExperienceState.parse(await response.json());
    },
    async send(
      profile: string,
      scope: string,
      text: string,
      requestId: string = randomUUID(),
    ) {
      const response = await request(
        `experiences/${profile}/scopes/${scope}/messages`,
        { requestId, text },
      );
      assert.equal(response.status, 202, await response.clone().text());
      return ExperienceAdmission.parse(await response.json());
    },
    async settled(profile: string, jobId: string) {
      const runtime = await live.pi.experiences?.resolve(profile);
      assert(runtime);
      return runtime.wait(jobId);
    },
    async reopen() {
      await live.app.close();
      live = await open();
    },
    async close() {
      await live.app.close();
      closed = true;
    },
  };
}
