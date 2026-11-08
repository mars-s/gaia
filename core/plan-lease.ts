import { createConnection } from "node:net";
import { z } from "zod";
import type { CredentialStore } from "@earendil-works/pi-ai";
import type { PlanProvider } from "../packages/protocol/index.ts";
export const PlanLeaseEnv = z.object({
  GAIA_PLAN_LEASE_SOCKET: z.string().startsWith("/"),
  GAIA_PLAN_LEASE_KEY: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  GAIA_PLAN_LEASE_PROVIDER: z.enum(["openai-codex", "anthropic"]),
});
export type PlanLease = { socket: string; key: string; provider: PlanProvider };
export const LeaseRequest = z.object({ key: z.string().max(64), provider: z.enum(["openai-codex", "anthropic"]) }).strict();
export const LeaseReply = z.union([
  z.object({ ok: z.literal(true), access: z.string().min(1).max(12000), expires: z.number().int() }).strict(),
  z.object({ ok: z.literal(false) }).strict(),
]);
export const LEASE_MS = 15 * 60_000;
export const LEASE_UNAVAILABLE = "The owner's plan is not available to this test copy.";
export function planLease(env: NodeJS.ProcessEnv): PlanLease {
  const parsed = PlanLeaseEnv.safeParse(env);
  delete env.GAIA_PLAN_LEASE_KEY;
  if (!parsed.success) throw new Error(LEASE_UNAVAILABLE);
  return { socket: parsed.data.GAIA_PLAN_LEASE_SOCKET, key: parsed.data.GAIA_PLAN_LEASE_KEY, provider: parsed.data.GAIA_PLAN_LEASE_PROVIDER };
}
export function leaseStore(lease: PlanLease): CredentialStore {
  type Credential = { type: "oauth"; access: string; refresh: string; expires: number };
  let cached: Credential | undefined;
  let pending: Promise<Credential> | undefined;
  const fetch = () => pending ??= new Promise<Credential>((resolve, reject) => {
    const socket = createConnection(lease.socket);
    let input = Buffer.alloc(0);
    const fail = () => { socket.destroy(); reject(new Error(LEASE_UNAVAILABLE)); };
    socket.setTimeout(5000, fail);
    socket.on("error", fail);
    socket.on("end", fail);
    socket.on("connect", () => socket.write(JSON.stringify({ key: lease.key, provider: lease.provider }) + "\n"));
    socket.on("data", (chunk: Buffer) => {
      input = Buffer.concat([input, chunk]);
      if (input.length > 16384) return fail();
      if (!input.includes(10)) return;
      try {
        const reply = LeaseReply.parse(JSON.parse(input.toString("utf8")));
        if (!reply.ok || reply.expires <= Date.now() || reply.expires > Date.now() + LEASE_MS) return fail();
        cached = { type: "oauth", access: reply.access, refresh: "", expires: reply.expires };
        resolve(cached);
        socket.destroy();
      } catch { fail(); }
    });
  }).finally(() => { pending = undefined; });
  return {
    async read(id) { return id !== lease.provider ? undefined : cached && cached.expires > Date.now() ? cached : fetch(); },
    async modify(id) { if (id !== lease.provider) throw new Error(LEASE_UNAVAILABLE); return fetch(); },
    async list() { return [{ providerId: lease.provider, type: "oauth" }]; },
    async delete() { cached = undefined; },
  };
}
