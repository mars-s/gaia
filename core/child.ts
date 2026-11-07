import { DatabaseSync } from "node:sqlite";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createAuth } from "./auth.ts";
import { selfChangeTools } from "./tools.ts";
import { readState } from "./state.ts";
import { control } from "./control-client.ts";
import { webResource } from "./web.ts";
import { QuiesceRequest, QuiesceReceipt } from "./quiescence.ts";
import { machineGate } from "./machine-gate.ts";
import type { createChatServer, AuthService } from "../apps/server/server.ts";
import type { createPi, ChatAdapter } from "../apps/server/pi.ts";
const env = z
  .object({
    GAIA_RELEASE: z.string(),
    GAIA_RELEASE_DIR: z.string(),
    GAIA_GENERATION: z.string(),
    GAIA_DATA_DIR: z.string(),
    GAIA_PORT: z.coerce.number(),
    GAIA_HOST: z.string(),
    GAIA_CREDENTIALS: z.string(),
    GAIA_CONTROL_SOCKET: z.string(),
    GAIA_PROBE_TOKEN: z.string(),
  })
  .parse(process.env);
const sandbox = process.argv.includes("--sandbox-probe");
const test = sandbox || process.argv.includes("--test-provider");
const { createChatServer: serverFactory, openDatabase } = (await import(
  pathToFileURL(join(env.GAIA_RELEASE_DIR, "apps/server/server.ts")).href
)) as {
  createChatServer: typeof createChatServer;
  openDatabase: typeof import("../apps/server/server.ts").openDatabase;
};
const { createPi: piFactory } = (await import(
  pathToFileURL(join(env.GAIA_RELEASE_DIR, "apps/server/pi.ts")).href
)) as { createPi: typeof createPi };
const credentials = new DatabaseSync(env.GAIA_CREDENTIALS);
const auth = createAuth(credentials);
if (!test) await auth.initialise(false);
const testAuth: AuthService = {
  status: () => ({ kind: "connected", model: "gpt-6.1-sol" }),
  connect() {},
  reply() {},
  async close() {},
};
const service: AuthService = test ? testAuth : { ...auth, async close() {} };
const deterministic = (): ChatAdapter => ({
  async run({ text, onText }) {
    onText(text);
  },
  async close() {},
});
const runtime = () => ({
  release: env.GAIA_RELEASE,
  mode,
  selfModification: mode === "stable",
});
let mode = sandbox ? "probe" : (await readState(env.GAIA_DATA_DIR)).kind;
let closing: Promise<void> | undefined;
const dispatchMode = machineGate(
  env.GAIA_DATA_DIR,
  {
    release: env.GAIA_RELEASE,
    generation: basename(env.GAIA_GENERATION),
  },
  sandbox,
);
const origins = [
  `http://${env.GAIA_HOST}:${env.GAIA_PORT}`,
  `http://127.0.0.1:${env.GAIA_PORT}`,
  `http://localhost:${env.GAIA_PORT}`,
];
const app = serverFactory({
  db: await openDatabase(env.GAIA_GENERATION),
  adapter: test
    ? deterministic()
    : await piFactory(
        join(env.GAIA_GENERATION, "pi.sqlite"),
        auth,
        mode === "safe" ? [] : [selfChangeTools(env.GAIA_CONTROL_SOCKET)],
        {},
        {
          areasEnabled: mode !== "safe",
          experiencesEnabled: mode !== "safe",
          experiences: {
            extensions:
              mode === "safe" ? [] : [selfChangeTools(env.GAIA_CONTROL_SOCKET)],
            capabilities: () => ({
              selfModification: dispatchMode() === "stable",
            }),
          },
          tools:
            mode === "safe"
              ? undefined
              : {
                  receiptDirectory: join(env.GAIA_GENERATION, "tool-receipts"),
                  generation: basename(env.GAIA_GENERATION),
                  mode: dispatchMode,
                  enabled: () => !closing,
                },
        },
      ),
  auth: service,
  origins,
  runtime,
  allowWrite: async () =>
    !closing &&
    (sandbox ||
      ["stable", "checking", "safe"].includes(
        (await readState(env.GAIA_DATA_DIR)).kind,
      )),
});
const probe = serverFactory({
  db: await openDatabase(join(env.GAIA_GENERATION, "probe")),
  adapter: test
    ? deterministic()
    : await piFactory(join(env.GAIA_GENERATION, "probe/pi.sqlite"), auth),
  auth: service,
  origins,
  runtime,
});
const handlers = app.server.listeners("request");
const probeHandlers = probe.server.listeners("request");
app.server.removeAllListeners("request");
app.server.on("request", async (req, res) => {
  const json = (status: number, value: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  try {
    const url = new URL(req.url ?? "/", "http://local");
    if (
      !origins.some((origin) => new URL(origin).host === req.headers.host) ||
      (req.headers.origin && !origins.includes(req.headers.origin)) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      return json(403, { error: "Untrusted origin or host." });
    res.setHeader("X-Gaia-Release", env.GAIA_RELEASE);
    if (!sandbox) mode = (await readState(env.GAIA_DATA_DIR)).kind;
    if (url.pathname === "/healthz")
      return json(200, {
        ok: true,
        release: env.GAIA_RELEASE,
        mode,
        schema: 1,
        provider: test ? "deterministic-test-only" : "pi-openai-codex",
      });
    if (url.pathname.startsWith("/api/v1/probe/")) {
      if (req.headers["x-gaia-probe"] !== env.GAIA_PROBE_TOKEN)
        return json(403, { error: "Probe access denied." });
      req.url = req.url?.replace("/api/v1/probe/", "/api/v1/");
      for (const handler of probeHandlers) handler.call(probe.server, req, res);
      return;
    }
    if (
      req.method === "POST" &&
      (closing || (mode !== "stable" && mode !== "checking" && mode !== "safe"))
    ) {
      res.setHeader("Retry-After", "2");
      return json(503, {
        error: "Gaia is checking a release. Retry shortly.",
        retryable: true,
      });
    }
    if (url.pathname.startsWith("/api/v1/selfmod/")) {
      if (sandbox)
        return json(503, { error: "Self-change is disabled in sandbox." });
      const action = url.pathname.slice("/api/v1/selfmod/".length);
      if (req.method === "GET" && (action === "status" || action === "history"))
        return json(
          200,
          await control(env.GAIA_CONTROL_SOCKET, { kind: action }),
        );
      if (req.method === "GET" && action.startsWith("images/")) {
        const [, id, file] = action.split("/");
        const image = z
          .object({ data: z.string(), mimeType: z.literal("image/jpeg") })
          .parse(
            await control(
              env.GAIA_CONTROL_SOCKET,
              (await import("./state.ts")).Command.parse({
                kind: "image",
                id,
                file,
              }),
            ),
          );
        res.writeHead(200, {
          "Content-Type": image.mimeType,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(Buffer.from(image.data, "base64"));
        return;
      }
      if (
        req.method !== "POST" ||
        !["stage", "preview", "submit", "revert"].includes(action)
      )
        return json(404, { error: "Not found." });
      if (req.headers["content-type"] !== "application/json")
        return json(415, { error: "Use application/json." });
      req.setEncoding("utf8");
      let input = "";
      for await (const chunk of req) {
        input += chunk;
        if (Buffer.byteLength(input) > 1000000)
          return json(413, { error: "Change too large." });
      }
      const command = (await import("./state.ts")).Command.parse({
        ...JSON.parse(input),
        kind: action,
      });
      return json(202, await control(env.GAIA_CONTROL_SOCKET, command));
    }
    if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
      const resource = await webResource(url.pathname, {
        data: env.GAIA_DATA_DIR,
        release: env.GAIA_RELEASE,
        directory: env.GAIA_RELEASE_DIR,
      });
      res.writeHead(resource.status, {
        "Content-Type": resource.type,
        "Cache-Control": "no-cache",
      });
      res.end(resource.body);
      return;
    }
    for (const handler of handlers) handler.call(app.server, req, res);
  } catch (error) {
    json(400, {
      error:
        error instanceof Error
          ? error.message.slice(0, 2000)
          : "Request failed.",
    });
  }
});
app.server.listen(env.GAIA_PORT, env.GAIA_HOST, () =>
  process.stdout.write(`Gaia child ${env.GAIA_RELEASE}\n`),
);
function close() {
  return (closing ??= (async () => {
    await app.close();
    await probe.close();
    await auth.close();
    credentials.close();
  })());
}
function exit() {
  void close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
}
process.on("message", (value: unknown) => {
  const parsed = QuiesceRequest.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.release !== env.GAIA_RELEASE ||
    parsed.data.generation !== env.GAIA_GENERATION
  )
    return;
  void (async () => {
    await close();
    const receipt = QuiesceReceipt.parse({
      ...parsed.data,
      kind: "gaia.quiesced",
    });
    await new Promise<void>((resolve, reject) => {
      if (!process.send || !process.connected) {
        reject(new Error("Supervisor disconnected before shutdown receipt."));
        return;
      }
      process.send(receipt, (error) => (error ? reject(error) : resolve()));
    });
    process.exit(0);
  })().catch(() => process.exit(1));
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, exit);
process.on("disconnect", exit);
