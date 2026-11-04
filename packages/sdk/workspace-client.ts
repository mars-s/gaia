import { z } from "zod";
import { ApiError, Thread } from "../protocol/index.ts";
import { Attachment, type ImageUpload } from "../protocol/attachments.ts";
import { AreaSnapshot } from "./areas.ts";
import {
  AreaId,
  Workspace,
  WorkspaceState,
  WorkspaceProposal,
  WorkspaceConfirmation,
  WorkspaceRequest,
} from "./workspace.ts";

const ConfirmationResult = z.strictObject({
  kind: z.enum(["confirmed", "already_confirmed"]),
  workspace: Workspace,
});
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  input?: unknown,
  signal?: AbortSignal,
  timeout = 15000,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/${path}`, {
      method: input === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout),
      cache: "no-store",
    });
  } catch (cause) {
    const message = signal?.aborted
      ? "Request cancelled."
      : cause instanceof Error && cause.name === "TimeoutError"
        ? "Gaia is taking too long to respond. Try again. Your draft is still here."
        : "Gaia could not be reached. Check your connection and try again.";
    throw new Error(message, { cause });
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch (cause) {
    throw new Error(
      "Gaia returned an unreadable response. Try again. Your draft is still here.",
      { cause },
    );
  }
  if (!response.ok) {
    const error = ApiError.safeParse(value);
    throw new Error(
      error.success
        ? error.data.error
        : "Gaia could not complete that request. Try again.",
    );
  }
  const result = schema.safeParse(value);
  if (!result.success)
    throw new Error(
      "Gaia returned unsupported conversation details. Try reconnecting.",
      { cause: result.error },
    );
  return result.data;
}
export function readWorkspace(signal?: AbortSignal) {
  return request("workspace", WorkspaceState, undefined, signal);
}
export function proposeWorkspace(
  input: WorkspaceRequest,
  signal?: AbortSignal,
) {
  return request(
    "workspace/propose",
    WorkspaceProposal,
    WorkspaceRequest.parse(input),
    signal,
  );
}
export function confirmWorkspace(
  input: WorkspaceConfirmation,
  signal?: AbortSignal,
) {
  return request(
    "workspace/confirm",
    ConfirmationResult,
    WorkspaceConfirmation.parse(input),
    signal,
  );
}
export function readArea(areaId: AreaId, signal?: AbortSignal) {
  return request(
    `areas/${AreaId.parse(areaId)}/state`,
    AreaSnapshot,
    undefined,
    signal,
  );
}
export function readAreaHistory(areaId: AreaId, signal?: AbortSignal) {
  return request(
    `areas/${AreaId.parse(areaId)}/history`,
    Thread,
    undefined,
    signal,
  );
}
export function areaCommand(
  areaId: AreaId,
  action: "messages" | "retry" | "stop" | "model" | "compact",
  input: unknown = {},
  signal?: AbortSignal,
) {
  return request(
    `areas/${AreaId.parse(areaId)}/${action}`,
    AreaSnapshot,
    input,
    signal,
  );
}
export function uploadAreaImage(
  areaId: AreaId,
  input: ImageUpload,
  signal?: AbortSignal,
) {
  return request(
    `areas/${AreaId.parse(areaId)}/attachments`,
    Attachment,
    input,
    signal,
    120000,
  );
}
