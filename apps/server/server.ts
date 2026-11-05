import { createExperienceRoutes } from "./experience-http.ts";
import { createServer, type IncomingMessage } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import {
  Send,
  ModelSelection,
  type Chat,
  AuthReply,
  Empty,
  Thread,
  type Snapshot,
  type Connection,
} from "../../packages/protocol/index.ts";
import { openOwnerProfile } from "./profile.ts";
import { openAttachments, AttachmentError } from "./attachments.ts";
import {
  ImageUpload,
  imageLimits,
  type Attachment,
} from "../../packages/protocol/attachments.ts";
import {
  ProfileConfirmation,
  type OwnerCapability,
} from "../../packages/sdk/onboarding.ts";
import type { ChatAdapter } from "./pi.ts";
import { HttpError } from "./http-error.ts";
import { WorkspaceError } from "./pi-workspace.ts";
import {
  createWorkspaceRoutes,
  type WorkspaceScope,
} from "./workspace-http.ts";
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
async function body(req: IncomingMessage, limit = 140000): Promise<unknown> {
  if (req.headers["content-type"] !== "application/json")
    throw new HttpError(415, "Use application/json.");
  req.setEncoding("utf8");
  let content = "";
  for await (const chunk of req) {
    content += String(chunk);
    if (Buffer.byteLength(content) > limit)
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
  runtime,
  allowWrite,
}: {
  db: DatabaseSync;
  adapter: ChatAdapter;
  auth: AuthService;
  origins: string[];
  runtime?: () => Snapshot["runtime"];
  allowWrite?: () => Promise<boolean>;
}) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY)",
  );
  const rememberedAreaRequests = new Set<string>();
  const rememberRequest = db.prepare(
    "INSERT OR IGNORE INTO requests VALUES (?)",
  );
  function rememberAreaRequests() {
    for (const requestId of adapter.workspace?.requestIds() ?? []) {
      if (rememberedAreaRequests.has(requestId)) continue;
      rememberRequest.run(requestId);
      rememberedAreaRequests.add(requestId);
    }
  }
  rememberAreaRequests();
  const profile = openOwnerProfile(db);
  const attachments = openAttachments(db);
  const saved = db.prepare("SELECT value FROM chat WHERE id=1").get();
  let thread: Thread = saved
    ? Thread.parse(JSON.parse(String(saved.value)))
    : { version: 1, id: "local", messages: [], run: { kind: "idle" } };
  if (thread.run.kind === "running")
    thread = {
      ...thread,
      run:
        thread.run.operation && thread.run.operation !== "reply"
          ? { kind: "idle" }
          : {
              kind: "error",
              message:
                "The server restarted during this work. Try again when ready.",
            },
    };
  const persist = () =>
    db
      .prepare("INSERT OR REPLACE INTO chat VALUES (1,?)")
      .run(JSON.stringify(thread));
  persist();
  let compaction: Chat["compaction"] = { kind: "idle" };
  const snapshot = (): Snapshot => ({
    ...(adapter.controls && adapter.configure && adapter.compact
      ? { chat: { ...adapter.controls(), compaction } }
      : {}),
    thread,
    connection: auth.status(),
    ...(runtime ? { runtime: runtime() } : {}),
  });
  const listeners = new Set<(value: Snapshot) => void>();
  const publish = () => {
    persist();
    for (const listener of listeners) listener(snapshot());
  };
  let active:
    | {
        controller: AbortController;
        done: Promise<unknown>;
        scope: "home" | WorkspaceScope;
      }
    | undefined;
  let closing = false;
  function requireIdle() {
    if (closing) throw new HttpError(503, "Gaia is shutting down.");
    if (active || thread.run.kind === "running")
      throw new HttpError(409, "Work is already running.");
  }
  function controlOperation<T>(
    work: (signal: AbortSignal) => Promise<T>,
    external?: AbortSignal,
    operation: "model" | "compact" | "upload" = "model",
  ) {
    requireIdle();
    const previous = thread.run;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    external?.addEventListener("abort", cancel, { once: true });
    if (external?.aborted) cancel();
    thread.run = { kind: "running", id: randomUUID(), operation };
    const done = Promise.resolve()
      .then(() => work(controller.signal))
      .finally(() => {
        external?.removeEventListener("abort", cancel);
        thread.run = previous;
        active = undefined;
        publish();
      });
    active = { controller, done, scope: "home" };
    publish();
    return done;
  }
  function run(
    text: string,
    requestId: string,
    addUser: boolean,
    selection?: Thread["messages"][number]["selection"],
    files: Attachment[] = [],
  ) {
    requireIdle();
    if (auth.status().kind !== "connected")
      throw new HttpError(409, "Connect ChatGPT before sending.");
    const model = adapter
      .controls?.()
      .models.find(
        (model) =>
          model.id === (selection?.modelId ?? adapter.controls?.().modelId),
      );
    if (files.length && !model?.capabilities?.images)
      throw new HttpError(
        409,
        "This model does not accept images. Choose an image-capable model or remove the images.",
      );
    const images = files.map((file) => {
      const stored = attachments.read(file.id);
      if (JSON.stringify(stored.attachment) !== JSON.stringify(file))
        throw new AttachmentError(
          "Stored image details changed. Attach it again.",
        );
      return {
        type: "image" as const,
        data: stored.data,
        mimeType: stored.attachment.mimeType,
      };
    });
    const id = randomUUID();
    const now = new Date().toISOString();
    if (addUser)
      thread.messages.push({
        id: requestId,
        role: "user",
        text,
        createdAt: now,
        ...(files.length ? { attachments: files } : {}),
        ...(adapter.controls
          ? {
              selection: {
                modelId: adapter.controls().modelId,
                thinkingLevel: adapter.controls().thinkingLevel,
              },
            }
          : {}),
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
    let capabilityActive = true;
    const owner: OwnerCapability = {
      read() {
        try {
          return profile.read();
        } catch {
          return undefined;
        }
      },
      propose(value) {
        if (!capabilityActive || controller.signal.aborted)
          throw new Error("Setup turn expired.");
        profile.propose(value);
      },
      record(answers) {
        if (!capabilityActive || controller.signal.aborted)
          throw new Error("Setup turn expired.");
        profile.record(answers);
      },
    };
    const done = Promise.resolve()
      .then(async () => {
        if (selection && adapter.configure) {
          await adapter.configure(selection.modelId, selection.thinkingLevel);
          controller.signal.throwIfAborted();
        }
      })
      .then(() =>
        adapter.run({
          owner,
          text,
          images,
          attachments: files,
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
        capabilityActive = false;
        active = undefined;
        publish();
      });
    active = { controller, done, scope: "home" };
  }
  const workspaceRoutes = createWorkspaceRoutes({
    workspace: adapter.workspace,
    db,
    attachments,
    connected: () => auth.status().kind === "connected",
    admit<T>(
      scope: WorkspaceScope,
      work: (signal: AbortSignal) => Promise<T>,
      external?: AbortSignal,
    ) {
      requireIdle();
      const controller = new AbortController();
      const cancel = () => controller.abort();
      external?.addEventListener("abort", cancel, { once: true });
      if (external?.aborted) cancel();
      let begin = () => {};
      const done = new Promise<T>((resolve, reject) => {
        begin = () => {
          try {
            resolve(work(controller.signal));
          } catch (error) {
            reject(error);
          }
        };
      }).finally(() => {
        external?.removeEventListener("abort", cancel);
        active = undefined;
      });
      active = { controller, done, scope };
      begin();
      return done;
    },
    async stop(areaId) {
      if (active && active.scope !== areaId)
        throw new HttpError(
          409,
          "Active work belongs to another conversation.",
        );
      active?.controller.abort();
      await active?.done.catch(() => {});
    },
  });
  const experienceRoutes = createExperienceRoutes(
    adapter.experiences,
    () => auth.status().kind === "connected",
  );
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
      if (req.method === "GET") {
        const experience = await experienceRoutes(req, res, url.pathname);
        if (experience) {
          if ("stream" in experience) return;
          return json(experience.status, experience.value);
        }
        const result = workspaceRoutes.get(url.pathname);
        if (result) return json(result.status, result.value);
      }
      if (req.method === "GET" && url.pathname === "/api/v1/onboarding")
        return json(200, {
          version: 1,
          kind: auth.status().kind === "connected" ? "ready" : "connect",
          connection: auth.status(),
        });
      if (req.method === "GET" && url.pathname === "/api/v1/profile") {
        if (auth.status().kind !== "connected")
          throw new HttpError(409, "Connect ChatGPT first.");
        return json(200, profile.read());
      }
      if (req.method === "GET" && url.pathname === "/api/v1/state")
        return json(200, snapshot());
      if (
        req.method === "GET" &&
        url.pathname.startsWith("/api/v1/attachments/")
      ) {
        if (auth.status().kind !== "connected")
          throw new HttpError(409, "Connect ChatGPT first.");
        const stored = attachments.read(
          url.pathname.slice("/api/v1/attachments/".length),
        );
        res.writeHead(200, {
          "Content-Type": stored.attachment.mimeType,
          "Content-Length": stored.bytes.length,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": "inline",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        });
        return res.end(stored.bytes);
      }
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
      const input = await body(
        req,
        url.pathname === "/api/v1/attachments" ||
          /^\/api\/v1\/areas\/[^/]+\/attachments$/.test(url.pathname) ||
          /^\/api\/v1\/experiences\/[^/]+\/scopes\/[^/]+\/attachments$/.test(
            url.pathname,
          )
          ? Math.ceil(imageLimits.bytes / 3) * 4 + 4096
          : 140000,
      );
      if (closing) throw new HttpError(503, "Gaia is shutting down.");
      if (allowWrite && !(await allowWrite())) {
        res.setHeader("Retry-After", "2");
        throw new HttpError(503, "Gaia is checking a release. Retry shortly.");
      }
      const experience = await experienceRoutes(req, res, url.pathname, input);
      if (experience) {
        if ("stream" in experience) return;
        return json(experience.status, experience.value);
      }
      rememberAreaRequests();
      const workspaceResult = await workspaceRoutes.post(
        url.pathname,
        input,
        res,
      );
      if (workspaceResult)
        return json(workspaceResult.status, workspaceResult.value);
      if (
        [
          "/api/v1/stop",
          "/api/v1/retry",
          "/api/v1/auth/connect",
          "/api/v1/compact",
        ].includes(url.pathname) &&
        !Empty.safeParse(input).success
      )
        throw new HttpError(400, "Expected an empty object.");
      if (url.pathname.startsWith("/api/v1/profile/")) {
        const action = url.pathname.slice("/api/v1/profile/".length);
        const parsed =
          action === "confirm"
            ? ProfileConfirmation.safeParse(input)
            : Empty.safeParse(input);
        if (!parsed.success)
          throw new HttpError(
            400,
            action === "confirm"
              ? "Confirm the proposal shown in the app."
              : "Expected an empty object.",
          );
        if (auth.status().kind !== "connected")
          throw new HttpError(409, "Connect ChatGPT first.");
        if (action === "skip" && active?.scope === "home") {
          active.controller.abort();
          await active.done.catch(() => {});
        }
        requireIdle();
        if (
          !profile.action(
            action,
            "proposalId" in parsed.data ? parsed.data.proposalId : undefined,
          )
        )
          throw new HttpError(409, "Profile action is not available.");
        publish();
        return json(202, snapshot());
      }
      switch (url.pathname) {
        case "/api/v1/attachments": {
          const parsed = ImageUpload.safeParse(input);
          if (!parsed.success)
            throw new HttpError(
              400,
              "Choose PNG, JPEG or WebP images up to 10 MB.",
            );
          requireIdle();
          if (auth.status().kind !== "connected")
            throw new HttpError(409, "Connect ChatGPT first.");
          const controls = adapter.controls?.();
          if (
            !controls?.models.find((model) => model.id === controls.modelId)
              ?.capabilities?.images
          )
            throw new HttpError(409, "This model does not accept images.");
          const disconnected = new AbortController();
          const disconnect = () => {
            if (!res.writableEnded) disconnected.abort();
          };
          res.once("close", disconnect);
          try {
            const saved = await controlOperation(
              (signal) =>
                attachments.put(parsed.data, signal, adapter.imageLimits?.()),
              disconnected.signal,
              "upload",
            );
            return json(201, saved);
          } finally {
            res.removeListener("close", disconnect);
          }
        }
        case "/api/v1/model": {
          const parsed = ModelSelection.safeParse(input);
          if (!parsed.success)
            throw new HttpError(400, "Expected a modelId string only.");
          requireIdle();
          if (!adapter.controls || !adapter.configure || !adapter.compact)
            throw new HttpError(409, "Chat controls are unavailable.");
          const model = adapter
            .controls()
            .models.find((model) => model.id === parsed.data.modelId);
          if (!model) throw new HttpError(400, "Unknown OpenAI model.");
          if (
            parsed.data.thinkingLevel !== undefined &&
            !model.capabilities?.thinkingLevels.includes(
              parsed.data.thinkingLevel,
            )
          )
            throw new HttpError(
              400,
              "This model does not support that effort.",
            );
          const configure = adapter.configure.bind(adapter);
          await controlOperation(async () =>
            configure(parsed.data.modelId, parsed.data.thinkingLevel),
          );
          break;
        }
        case "/api/v1/compact": {
          requireIdle();
          if (!adapter.controls || !adapter.configure || !adapter.compact)
            throw new HttpError(409, "Chat controls are unavailable.");
          if (auth.status().kind !== "connected")
            throw new HttpError(409, "Connect ChatGPT before compacting.");
          const compact = adapter.compact.bind(adapter);
          compaction = {
            kind: "running",
            message: "Compacting conversation context.",
          };
          void controlOperation(
            async (signal) => {
              try {
                const kind = await compact(signal);
                compaction = signal.aborted
                  ? { kind: "error", message: "Compaction stopped." }
                  : {
                      kind,
                      message:
                        kind === "done"
                          ? "Conversation context compacted."
                          : "No older context to compact.",
                    };
              } catch {
                compaction = {
                  kind: "error",
                  message: signal.aborted
                    ? "Compaction stopped."
                    : "Compaction failed. Try again when ready.",
                };
              }
            },
            undefined,
            "compact",
          );
          break;
        }
        case "/api/v1/messages": {
          const parsed = Send.safeParse(input);
          if (!parsed.success)
            throw new HttpError(
              400,
              "Enter up to 32000 characters or attach up to four images, with a UUID requestId.",
            );
          const original = thread.messages.find(
            (message) =>
              message.id === parsed.data.requestId && message.role === "user",
          );
          if (
            original ||
            db
              .prepare("SELECT id FROM requests WHERE id=?")
              .get(parsed.data.requestId)
          ) {
            if (
              !original ||
              original.text !== parsed.data.text ||
              JSON.stringify(
                original.attachments?.map((file) => file.id) ?? [],
              ) !== JSON.stringify(parsed.data.attachments ?? [])
            )
              throw new HttpError(
                409,
                "That requestId belongs to a different message.",
              );
            return json(200, snapshot());
          }
          requireIdle();
          const files = (parsed.data.attachments ?? []).map(
            (id) => attachments.read(id).attachment,
          );
          run(parsed.data.text, parsed.data.requestId, true, undefined, files);
          db.prepare("INSERT INTO requests VALUES (?)").run(
            parsed.data.requestId,
          );
          break;
        }
        case "/api/v1/stop":
          if (active && active.scope !== "home")
            throw new HttpError(
              409,
              "Active work belongs to another conversation.",
            );
          active?.controller.abort();
          break;
        case "/api/v1/retry": {
          requireIdle();
          const last = thread.messages.findLast((m) => m.role === "user");
          if (!last) throw new HttpError(409, "No message to retry.");
          // Retry asks for another answer to the same retained user message.
          run(last.text, randomUUID(), false, last.selection, last.attachments);
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
      if (res.destroyed) return;
      json(
        error instanceof HttpError
          ? error.status
          : error instanceof WorkspaceError
            ? 409
            : error instanceof AttachmentError
              ? 400
              : 500,
        {
          error:
            error instanceof HttpError ||
            error instanceof AttachmentError ||
            error instanceof WorkspaceError
              ? error.message
              : "Local server error.",
        },
      );
    }
  });
  server.on("connection", (socket) => {
    serverSockets.add(socket);
    socket.on("close", () => serverSockets.delete(socket));
  });
  return {
    server,
    snapshot,
    async busy() {
      const experiences = await adapter.experiences?.busy();
      return { legacy: Boolean(active), experiences };
    },
    async quiesce() {
      closing = true;
      const experiences = adapter.experiences?.quiesce();
      active?.controller.abort();
      await Promise.all([active?.done.catch(() => {}), experiences]);
      return experiences;
    },
    async close() {
      closing = true;
      const experiences = adapter.experiences?.quiesce();
      active?.controller.abort();
      await active?.done.catch(() => {});
      await experiences;
      for (const socket of serverSockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error &&
          (!("code" in error) || error.code !== "ERR_SERVER_NOT_RUNNING")
            ? reject(error)
            : resolve(),
        ),
      );
      await adapter.close();
      await auth.close();
      db.close();
    },
  };
}
