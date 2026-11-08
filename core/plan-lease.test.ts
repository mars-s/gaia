import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { createAuth } from "./auth.ts";
import { leaseStore, planLease, LEASE_UNAVAILABLE } from "./plan-lease.ts";

for (const provider of ["openai-codex", "anthropic"] as const) {
  test(`${provider} leases resolve through Pi without refresh, login or persistence`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "gl-"));
    const socket = join(dir, "s");
    let requests = 0;
    let short = true;
    const server = createServer((client) => {
      client.once("data", () => {
        requests++;
        client.end(JSON.stringify({ ok: true, access: "synthetic-access", expires: Date.now() + (short ? 60_000 : 900_000) }) + "\n");
        short = false;
      });
    }).listen(socket);
    await once(server, "listening");
    t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(dir, { recursive: true }); });
    const store = leaseStore({ socket, key: "x".repeat(43), provider });
    const db = new DatabaseSync(":memory:");
    const auth = createAuth(db, { provider, store });
    t.after(async () => { await auth.close(); db.close(); });
    const real = provider === "anthropic" ? anthropicProvider() : openaiCodexProvider();
    assert(real.auth.oauth);
    let refreshes = 0;
    auth.models.setProvider({ ...real, auth: { oauth: { ...real.auth.oauth, async refresh() { refreshes++; throw new Error("Pi refresh must not run"); } } } });
    const first = await store.read(provider);
    assert.equal(first?.type === "oauth" && first.refresh, "");
    assert.equal(requests, 1);
    const resolved = await Promise.all(Array.from({ length: 8 }, () => auth.models.getAuth(provider)));
    assert(resolved.every((entry) => entry?.auth.apiKey === "synthetic-access"));
    assert.equal(requests, 2);
    assert.equal(refreshes, 0);
    assert.equal(await store.read(provider === "anthropic" ? "openai-codex" : "anthropic"), undefined);
    let called = false;
    await store.modify(provider, async () => { called = true; throw new Error("must not run"); });
    assert.equal(called, false);
    auth.connect(provider);
    assert.match(JSON.stringify(auth.status()), /Sign-in is off in this test copy/);
    assert(!JSON.stringify(auth.status()).includes("synthetic-access"));
    assert(!JSON.stringify(auth.status()).includes("x".repeat(43)));
    assert.equal(db.prepare("SELECT count(*) AS n FROM credentials").get()?.n, 0);
    await store.delete(provider);
    await store.read(provider);
    assert.equal(requests, 4);
  });
}

for (const reply of ["missing", "stall", "{", JSON.stringify({ ok: false }), "x".repeat(16385), JSON.stringify({ ok: true, access: "synthetic", expires: Date.now() + 100_000, refresh: "forbidden" }), JSON.stringify({ ok: true, access: "synthetic", expires: 1 })]) {
  test(`lease fails closed for ${reply.length > 80 ? "oversized or extra-field reply" : reply}`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "gl-"));
    const socket = join(dir, "s");
    const server = createServer((client) => {
      client.once("data", () => { if (reply !== "stall") client.end(reply + "\n"); });
    });
    if (reply !== "missing") { server.listen(socket); await once(server, "listening"); }
    t.after(async () => { if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve())); await rm(dir, { recursive: true }); });
    const store = leaseStore({ socket, key: "x".repeat(43), provider: "openai-codex" });
    await assert.rejects(store.read("openai-codex"), (error: Error) => error.message === LEASE_UNAVAILABLE && error.cause === undefined);
    if (reply === "missing") {
      for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
        const before = process.env[name];
        process.env[name] = "synthetic-api-key";
        t.after(() => { if (before === undefined) delete process.env[name]; else process.env[name] = before; });
      }
      const db = new DatabaseSync(":memory:");
      const auth = createAuth(db, { provider: "openai-codex", store });
      await assert.rejects(auth.models.getAuth("openai-codex"));
      await auth.close(); db.close();
    }
  });
}

test("lease environment strips the key even on invalid input", () => {
  const env = { GAIA_PLAN_LEASE_SOCKET: "/tmp/unused", GAIA_PLAN_LEASE_KEY: "x".repeat(43), GAIA_PLAN_LEASE_PROVIDER: "anthropic" };
  assert.equal(planLease(env).provider, "anthropic");
  assert.equal(env.GAIA_PLAN_LEASE_KEY, undefined);
  assert.throws(() => planLease(env), { message: LEASE_UNAVAILABLE });
});


test("invalid socket paths also use the fixed auth error", async () => {
  const store = leaseStore({ socket: "/tmp/invalid\0socket", key: "x".repeat(43), provider: "openai-codex" });
  await assert.rejects(store.read("openai-codex"), (error: Error) => error.message === LEASE_UNAVAILABLE && error.cause === undefined);
});
