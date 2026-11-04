import { z } from "zod";
import { ApiError } from "../protocol/index.ts";

// A browser-only view of managed records. Extra server fields are ignored.
export const ManagedChange = z.object({
  id: z.string().uuid(),
  reason: z.string(),
  at: z.string(),
  diff: z.string(),
  checks: z.array(z.string()),
  outcome: z.enum([
    "staged",
    "queued",
    "checking",
    "accepted",
    "rejected",
    "rolled-back",
    "interrupted",
  ]),
  detail: z.string(),
});
export type ManagedChange = z.infer<typeof ManagedChange>;
const History = z.object({
  version: z.literal(1),
  changes: z.array(ManagedChange),
});
const Status = z.object({
  version: z.literal(1),
  kind: z.enum(["stable", "safe", "checking", "switching", "probing"]),
  busy: z.boolean(),
  selfModification: z.boolean(),
  reason: z.string().optional(),
});
export type ManagedStatus = z.infer<typeof Status>;

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestInit,
  optional = false,
): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/selfmod/${path}`, options);
  } catch {
    throw new Error(
      "Changes are unavailable. Reconnect, then refresh history.",
    );
  }
  if (optional && response.status === 404) return null;
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("Change history could not be read. Try refreshing it.");
  }
  if (!response.ok) {
    const error = ApiError.safeParse(value);
    throw new Error(
      error.success
        ? error.data.error
        : "Changes are unavailable. Try refreshing shortly.",
    );
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "Gaia returned unsupported change details. Try refreshing after reconnecting.",
    );
  return parsed.data;
}

export async function readManaged(signal: AbortSignal) {
  const options = { signal, cache: "no-store" } satisfies RequestInit;
  const status = await request("status", Status, options, true);
  if (!status) return null;
  const history = await request("history", History, options, true);
  return history ? { status, changes: history.changes } : null;
}

export async function revertChange(id: string, signal: AbortSignal) {
  const change = await request("revert", ManagedChange, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: z.string().uuid().parse(id) }),
    signal,
  });
  if (!change)
    throw new Error(
      "Revert was not queued. Refresh history before trying again.",
    );
  return change;
}
