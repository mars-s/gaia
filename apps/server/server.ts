import { createServer, type IncomingMessage } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import {
  Send,
  AuthReply,
  Empty,
  Thread,
  type Snapshot,
  type Connection,
} from "../../packages/protocol/index.ts";
import type { ChatAdapter } from "./pi.ts";
export interface AuthService {
  status(): Connection;
  connect(): void;
  reply(value: string): void;
  close(): Promise<void>;
}
export async function openDatabase(dataDir: string) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await chmod(dataDir, 0o700);
  const path = join(dataDir, "gaia.sqlite");
  const db = new DatabaseSync(path);
  await chmod(path, 0o600);
  db.exec("PRAGMA journal_mode=WAL");
  return db;
}
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
async function body(req: IncomingMessage): Promise<unknown> {
  if (req.headers["content-type"] !== "application/json")
    throw new HttpError(415, "Use application/json.");
  req.setEncoding("utf8");
  let content = "";
  for await (const chunk of req) {
    content += String(chunk);
    if (Buffer.byteLength(content) > 140000)
      throw new HttpError(413, "Request too large.");
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}
export function createChatServer({
  db,
  adapter,
  auth,
  origins,
}: {
  db: DatabaseSync;
  adapter: ChatAdapter;
  auth: AuthService;
  origins: string[];
}) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY)",
  );
  const saved = db.prepare("SELECT value FROM chat WHERE id=1").get();
  let thread: Thread = saved
    ? Thread.parse(JSON.parse(String(saved.value)))
    : { version: 1, id: "local", messages: [], run: { kind: "idle" } };
  if (thread.run.kind === "running")
    thread = {
      ...thread,
      run: {
        kind: "error",
        message: "The server restarted during this reply. Retry when ready.",
      },
    };
  const persist = () =>
    db
      .prepare("INSERT OR REPLACE INTO chat VALUES (1,?)")
      .run(JSON.stringify(thread));
  persist();
  const snapshot = (): Snapshot => ({ thread, connection: auth.status() });
  const listeners = new Set<(value: Snapshot) => void>();
  const publish = () => {
    persist();
    for (const listener of listeners) listener(snapshot());
  };
  let active: { controller: AbortController; done: Promise<void> } | undefined;
  function run(text: string, requestId: string, addUser: boolean) {
    if (thread.run.kind === "running")
      throw new HttpError(409, "A reply is already running.");
    if (auth.status().kind !== "connected")
      throw new HttpError(409, "Connect ChatGPT before sending.");
    const id = randomUUID();
    const now = new Date().toISOString();
    if (addUser)
      thread.messages.push({
        id: requestId,
        role: "user",
        text,
        createdAt: now,
      });
    const answer: Thread["messages"][number] = {
      id,
      role: "assistant",
      text: "",
      createdAt: now,
    };
    thread.messages.push(answer);
    thread.run = { kind: "running", id };
    publish();
    const controller = new AbortController();
    const done = Promise.resolve()
      .then(() =>
        adapter.run({
          text,
          requestId,
          onText(value) {
            answer.text = value;
            publish();
          },
          signal: controller.signal,
        }),
      )
      .then(() => {
        thread.run = controller.signal.aborted
          ? { kind: "stopped" }
          : { kind: "idle" };
      })
      .catch(() => {
        thread.run = controller.signal.aborted
          ? { kind: "stopped" }
          : {
              kind: "error",
              message:
                "Sol could not finish this reply. Check your ChatGPT connection, then retry.",
            };
      })
      .finally(() => {
        active = undefined;
        publish();
      });
    active = { controller, done };
  }
  const serverSockets = new Set<Socket>();
  const server = createServer(async (req, res) => {
    const json = (status: number, value: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(value));
    };
    try {
      let url: URL;
      try {
        url = new URL(req.url ?? "/", "http://local");
      } catch {
        throw new HttpError(400, "Invalid request URL.");
      }
      // Exact origins and host validation also cover loopback DNS rebinding.
      const host = req.headers.host;
      if (!host || !origins.some((origin) => new URL(origin).host === host))
        throw new HttpError(403, "Untrusted host.");
      const origin = req.headers.origin;
      if (origin && !origins.includes(origin))
        throw new HttpError(403, "Untrusted origin.");
      if (req.headers["sec-fetch-site"] === "cross-site")
        throw new HttpError(403, "Cross-site requests are not allowed.");
      if (req.method === "GET" && url.pathname === "/healthz")
        return json(200, { ok: true });
      if (req.method === "GET" && url.pathname === "/api/v1/state")
        return json(200, snapshot());
      if (req.method === "GET" && url.pathname === "/api/v1/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        const send = (data: Snapshot) =>
          res.write(`data: ${JSON.stringify({ type: "snapshot", data })}\n\n`);
        send(snapshot());
        listeners.add(send);
        const interval = setInterval(() => send(snapshot()), 1000);
        req.on("close", () => {
          listeners.delete(send);
          clearInterval(interval);
        });
        return;
      }
      if (req.method !== "POST") throw new HttpError(404, "Not found.");
      const input = await body(req);
      if (
        ["/api/v1/stop", "/api/v1/retry", "/api/v1/auth/connect"].includes(
          url.pathname,
        ) &&
        !Empty.safeParse(input).success
      )
        throw new HttpError(400, "Expected an empty object.");
      switch (url.pathname) {
        case "/api/v1/messages": {
          const parsed = Send.safeParse(input);
          if (!parsed.success)
            throw new HttpError(
              400,
              "Enter a message of 1 to 32000 characters and a UUID requestId.",
            );
          if (
            db
              .prepare("SELECT id FROM requests WHERE id=?")
              .get(parsed.data.requestId)
          )
            return json(200, snapshot());
          run(parsed.data.text, parsed.data.requestId, true);
          db.prepare("INSERT INTO requests VALUES (?)").run(
            parsed.data.requestId,
          );
          break;
        }
        case "/api/v1/stop":
          active?.controller.abort();
          break;
        case "/api/v1/retry": {
          const last = thread.messages.findLast((m) => m.role === "user");
          if (!last) throw new HttpError(409, "No message to retry.");
          // Retry asks for another answer to the same retained user message.
          run(last.text, randomUUID(), false);
          break;
        }
        case "/api/v1/auth/connect":
          auth.connect();
          break;
        case "/api/v1/auth/reply": {
          const parsed = AuthReply.safeParse(input);
          if (!parsed.success)
            throw new HttpError(400, "Enter the sign-in reply.");
          auth.reply(parsed.data.value);
          break;
        }
        default:
          throw new HttpError(404, "Not found.");
      }
      json(202, snapshot());
    } catch (error) {
      json(error instanceof HttpError ? error.status : 500, {
        error:
          error instanceof HttpError ? error.message : "Local server error.",
      });
    }
  });
  server.on("connection", (socket) => {
    serverSockets.add(socket);
    socket.on("close", () => serverSockets.delete(socket));
  });
  return {
    server,
    snapshot,
    async close() {
      active?.controller.abort();
      await active?.done;
      for (const socket of serverSockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await adapter.close();
      await auth.close();
      db.close();
    },
  };
}
