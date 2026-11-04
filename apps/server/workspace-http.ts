import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import {
  Empty,
  ModelSelection,
  Send,
  type Message,
} from "../../packages/protocol/index.ts";
import { ImageUpload } from "../../packages/protocol/attachments.ts";
import {
  AreaId,
  WorkspaceConfirmation,
  WorkspaceRequest,
} from "../../packages/sdk/workspace.ts";
import { AttachmentError, type openAttachments } from "./attachments.ts";
import { HttpError } from "./http-error.ts";
import type { WorkspaceChat } from "./pi-workspace.ts";

export type WorkspaceScope = "workspace" | AreaId;
export function createWorkspaceRoutes({
  workspace,
  db,
  attachments,
  connected,
  admit,
  stop,
}: {
  workspace?: WorkspaceChat;
  db: DatabaseSync;
  attachments: ReturnType<typeof openAttachments>;
  connected: () => boolean;
  admit: <T>(
    scope: WorkspaceScope,
    work: (signal: AbortSignal) => Promise<T>,
    external?: AbortSignal,
  ) => Promise<T>;
  stop: (areaId: AreaId) => Promise<void>;
}) {
  function available() {
    if (!connected()) throw new HttpError(409, "Connect ChatGPT first.");
    if (!workspace)
      throw new HttpError(409, "Workspace controls are unavailable.");
    return workspace;
  }
  function path(value: string) {
    const match =
      /^\/api\/v1\/areas\/([^/]+)\/(state|history|messages|retry|stop|model|compact|attachments)$/.exec(
        value,
      );
    if (!match) return undefined;
    const parsed = AreaId.safeParse(match[1]);
    if (!parsed.success)
      throw new HttpError(400, "Expected a workspace area UUID.");
    return { areaId: parsed.data, action: match[2] };
  }
  function files(messages: Message["attachments"] = []) {
    const images = messages.map((file) => {
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
    return images;
  }
  return {
    get(url: string) {
      if (url === "/api/v1/workspace")
        return { status: 200, value: available().read() };
      const route = path(url);
      if (!route || !["state", "history"].includes(route.action))
        return undefined;
      const snapshot = available().snapshot(route.areaId);
      return {
        status: 200,
        value: route.action === "history" ? snapshot.thread : snapshot,
      };
    },
    async post(url: string, input: unknown, response: ServerResponse) {
      if (url === "/api/v1/workspace/propose") {
        const request = WorkspaceRequest.safeParse(input);
        if (!request.success)
          throw new HttpError(
            400,
            "Expected a bounded workspace plan and explicit sharedPreferences.",
          );
        const workspace = available();
        const proposal = await admit("workspace", (signal) =>
          workspace.propose(request.data, signal),
        );
        return { status: 201, value: proposal };
      }
      if (url === "/api/v1/workspace/confirm") {
        const confirmation = WorkspaceConfirmation.safeParse(input);
        if (!confirmation.success)
          throw new HttpError(
            400,
            "Confirm the exact proposalId and revision shown in the app.",
          );
        const workspace = available();
        const result = await admit("workspace", (signal) =>
          workspace.confirm(confirmation.data, signal),
        );
        if (result.kind === "stale")
          throw new HttpError(
            409,
            "Workspace proposal changed. Review the current proposal.",
          );
        return { status: 200, value: result };
      }
      const route = path(url);
      if (!route || ["state", "history"].includes(route.action))
        return undefined;
      const { areaId, action } = route;
      const workspace = available();
      const snapshot = workspace.snapshot(areaId);
      if (
        ["retry", "stop", "compact"].includes(action) &&
        !Empty.safeParse(input).success
      )
        throw new HttpError(400, "Expected an empty object.");
      switch (action) {
        case "messages": {
          const parsed = Send.safeParse(input);
          if (!parsed.success)
            throw new HttpError(
              400,
              "Enter up to 32000 characters or four images, with a UUID requestId.",
            );
          const original = snapshot.thread.messages.find(
            (message) =>
              message.role === "user" && message.id === parsed.data.requestId,
          );
          const retained = db
            .prepare("SELECT id FROM requests WHERE id=?")
            .get(parsed.data.requestId);
          if (original || retained) {
            if (
              !original ||
              original.text !== parsed.data.text ||
              JSON.stringify(
                original.attachments?.map((file) => file.id) ?? [],
              ) !== JSON.stringify(parsed.data.attachments ?? [])
            )
              throw new HttpError(
                409,
                "That requestId belongs to a different message or area.",
              );
            if (!retained)
              throw new HttpError(
                409,
                "That request is still being admitted. Retry shortly.",
              );
            return { status: 200, value: snapshot };
          }
          const saved = (parsed.data.attachments ?? []).map(
            (id) => attachments.read(id).attachment,
          );
          const images = files(saved);
          const selected = snapshot.chat.models.find(
            (model) => model.id === snapshot.chat.modelId,
          );
          if (images.length && !selected?.capabilities?.images)
            throw new HttpError(409, "This model does not accept images.");
          let accepted = () => {};
          const admitted = new Promise<void>((resolve) => {
            accepted = resolve;
          });
          const done = admit(areaId, (signal) =>
            workspace.run({
              areaId,
              ...parsed.data,
              attachments: saved,
              images,
              addUser: true,
              signal,
              onAdmitted: accepted,
            }),
          );
          void done.catch(() => {});
          await Promise.race([admitted, done]);
          db.prepare("INSERT OR IGNORE INTO requests VALUES (?)").run(
            parsed.data.requestId,
          );
          break;
        }
        case "retry": {
          const last = snapshot.thread.messages.findLast(
            (message) => message.role === "user",
          );
          if (!last)
            throw new HttpError(409, "No message to retry in this area.");
          const images = files(last.attachments);
          void admit(areaId, (signal) =>
            workspace.run({
              areaId,
              text: last.text,
              requestId: randomUUID(),
              selection: last.selection,
              attachments: last.attachments,
              images,
              addUser: false,
              signal,
            }),
          ).catch(() => {});
          break;
        }
        case "stop":
          await stop(areaId);
          break;
        case "model": {
          const parsed = ModelSelection.safeParse(input);
          if (!parsed.success)
            throw new HttpError(
              400,
              "Expected a modelId and optional thinkingLevel only.",
            );
          const model = snapshot.chat.models.find(
            (model) => model.id === parsed.data.modelId,
          );
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
          await admit(areaId, (signal) =>
            workspace.configure(
              areaId,
              parsed.data.modelId,
              parsed.data.thinkingLevel,
              signal,
            ),
          );
          break;
        }
        case "compact":
          void admit(areaId, (signal) =>
            workspace.compact(areaId, signal),
          ).catch(() => {});
          break;
        case "attachments": {
          const parsed = ImageUpload.safeParse(input);
          if (!parsed.success)
            throw new HttpError(
              400,
              "Choose PNG, JPEG or WebP images up to 10 MB.",
            );
          if (
            !snapshot.chat.models.find(
              (model) => model.id === snapshot.chat.modelId,
            )?.capabilities?.images
          )
            throw new HttpError(409, "This model does not accept images.");
          const disconnected = new AbortController();
          const disconnect = () => {
            if (!response.writableEnded) disconnected.abort();
          };
          response.once("close", disconnect);
          try {
            const saved = await admit(
              areaId,
              (signal) =>
                attachments.put(
                  parsed.data,
                  signal,
                  workspace.imageLimits(areaId),
                ),
              disconnected.signal,
            );
            return { status: 201, value: saved };
          } finally {
            response.removeListener("close", disconnect);
          }
        }
      }
      return { status: 202, value: workspace.snapshot(areaId) };
    },
  };
}
