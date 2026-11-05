import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  ExperienceCreate,
  ExperienceMainSelect,
  ExperienceConfirm,
  ExperienceSend,
  ExperienceRetry,
  ScopePlan,
  ExperienceId,
  ScopeId,
  JobId,
} from "../../packages/protocol/experiences.ts";
import { ModelSelection, Empty } from "../../packages/protocol/index.ts";
import { ImageUpload } from "../../packages/protocol/attachments.ts";
import type { ExperienceRuntime } from "./experiences/runtime.ts";
import { HttpError } from "./http-error.ts";

export function createExperienceRoutes(
  runtime: ExperienceRuntime | undefined,
  connected: () => boolean,
) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    input?: unknown,
  ) => {
    const parts = path.split("/").filter(Boolean);
    if (parts[0] !== "api" || parts[1] !== "v1" || parts[2] !== "experiences")
      return undefined;
    if (!runtime) throw new HttpError(404, "Experiences are unavailable.");
    if (!connected()) throw new HttpError(409, "Connect ChatGPT first.");
    const parse = <T>(schema: z.ZodType<T>) => {
      const value = schema.safeParse(input);
      if (!value.success)
        throw new HttpError(400, "Invalid experience request.");
      return value.data;
    };
    const ok = (value: unknown, status = 200) => ({ value, status });
    if (parts.length === 3) {
      if (req.method === "GET") return ok(await runtime.index());
      if (req.method === "POST")
        return ok(await runtime.create(parse(ExperienceCreate)), 201);
    }
    if (parts.length === 4 && parts[3] === "main") {
      if (req.method === "GET") return ok(runtime.main());
      if (req.method === "PUT")
        return ok(
          await runtime.selectMain(parse(ExperienceMainSelect).profileId),
        );
    }
    if (parts.length === 5 && parts[4] === "dismiss" && req.method === "POST") {
      parse(Empty);
      return ok(await runtime.dismiss(parts[3]));
    }
    if (!ExperienceId.safeParse(parts[3]).success)
      throw new HttpError(404, "Unknown experience profile.");
    const profile = await runtime.resolve(parts[3]);
    if (parts.length === 5 && parts[4] === "state" && req.method === "GET")
      return ok(await profile.state());
    if (req.method === "POST") {
      if (parts.length === 5 && parts[4] === "confirm")
        return ok(await profile.confirm(parse(ExperienceConfirm).revision));
      if (parts.length === 5 && parts[4] === "scopes")
        return ok(await profile.addScope(parse(ScopePlan)), 201);
      if (
        parts.length === 7 &&
        parts[4] === "jobs" &&
        JobId.safeParse(parts[5]).success
      ) {
        if (parts[6] === "stop") {
          parse(Empty);
          return ok(await profile.stop(parts[5]));
        }
        if (parts[6] === "retry")
          return ok(await profile.retry(parts[5], parse(ExperienceRetry)), 202);
      }
    }
    if (parts[4] !== "scopes" || !ScopeId.safeParse(parts[5]).success)
      throw new HttpError(404, "Unknown experience route.");
    const scope = parts[5];
    if (parts.length === 7) {
      if (req.method === "GET" && parts[6] === "state")
        return ok(await profile.scopeState(scope));
      if (req.method === "GET" && parts[6] === "events") {
        const initial = await profile.scopeState(scope);
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        let revision = initial.revision;
        res.write(`data: ${JSON.stringify(initial)}\n\n`);
        let pending = Promise.resolve();
        const unsubscribe = profile.subscribe(() => {
          pending = pending
            .then(async () => {
              if (res.destroyed) return;
              const state = await profile.scopeState(scope);
              if (state.revision > revision) {
                revision = state.revision;
                res.write(`data: ${JSON.stringify(state)}\n\n`);
              }
            })
            .catch(() => {
              res.destroy();
            });
        });
        const heartbeat = setInterval(() => {
          if (!res.destroyed) res.write("event: heartbeat\ndata: {}\n\n");
        }, 2000);
        heartbeat.unref();
        req.once("close", () => {
          clearInterval(heartbeat);
          unsubscribe();
        });
        return { stream: true as const };
      }
      if (req.method === "POST")
        switch (parts[6]) {
          case "messages":
            return ok(await profile.send(scope, parse(ExperienceSend)), 202);
          case "model":
            return ok(await profile.configure(scope, parse(ModelSelection)));
          case "compact":
            parse(Empty);
            return ok(await profile.compact(scope));
          case "attachments":
            return ok(await profile.upload(scope, parse(ImageUpload)), 201);
        }
    }
    if (
      req.method === "GET" &&
      parts.length === 8 &&
      parts[6] === "attachments"
    ) {
      const image = await profile.image(scope, parts[7]);
      res.writeHead(200, {
        "Content-Type": image.attachment.mimeType,
        "Content-Length": image.bytes.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      });
      res.end(image.bytes);
      return { stream: true as const };
    }
    throw new HttpError(404, "Unknown experience route.");
  };
}
