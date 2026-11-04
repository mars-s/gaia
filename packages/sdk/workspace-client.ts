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
  const response = await fetch(`/api/v1/${path}`, {
    method: input === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout),
    cache: "no-store",
  });
  const value: unknown = await response.json();
  if (!response.ok) throw new Error(ApiError.parse(value).error);
  return schema.parse(value);
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
