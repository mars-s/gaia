import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createModels } from "@earendil-works/pi-ai/models";
import type { CredentialStore } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { defaultPlanModel } from "./plan-models.ts";
import type { Connection, PlanProvider } from "../packages/protocol/index.ts";
const OAuth = z
  .object({
    type: z.literal("oauth"),
    access: z.string(),
    refresh: z.string(),
    expires: z.number(),
  })
  .catchall(z.unknown());
export function createAuth(db: DatabaseSync, lease?: { provider: PlanProvider; store: CredentialStore }) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS credentials (provider TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  let queue: Promise<unknown> = Promise.resolve();
  const store: CredentialStore = lease?.store ?? {
    async read(provider) {
      const row = db
        .prepare("SELECT value FROM credentials WHERE provider=?")
        .get(provider);
      return row ? OAuth.parse(JSON.parse(String(row.value))) : undefined;
    },
    async list() {
      return db
        .prepare("SELECT provider FROM credentials ORDER BY provider")
        .all()
        .map((row) => ({ providerId: String(row.provider), type: "oauth" }));
    },
    modify(provider, fn) {
      const next = queue.then(async () => {
        const current = await store.read(provider);
        const value = await fn(current);
        if (value)
          db.prepare("INSERT OR REPLACE INTO credentials VALUES (?,?)").run(
            provider,
            JSON.stringify(OAuth.parse(value)),
          );
        return value ?? current;
      });
      queue = next.catch(() => undefined);
      return next;
    },
    async delete(provider) {
      const next = queue.then(() => {
        db.prepare("DELETE FROM credentials WHERE provider=?").run(provider);
      });
      queue = next.catch(() => undefined);
      await next;
    },
  };
  const models = createModels({
    credentials: store,
    authContext: {
      async env() {
        return undefined;
      },
      async fileExists() {
        return false;
      },
    },
  });
  models.setProvider(openaiCodexProvider());
  const anthropic = anthropicProvider();
  models.setProvider({ ...anthropic, auth: { oauth: anthropic.auth.oauth } });
  const connectedProviders = () =>
    lease ? new Set([lease.provider]) : new Set(
      db
        .prepare("SELECT provider FROM credentials")
        .all()
        .map((row) => String(row.provider)),
    );
  const planAvailability = { connectedProviders };
  const loginErrors = new Map<PlanProvider, string>();
  const plans = () => {
    const connected = connectedProviders();
    return (["openai-codex", "anthropic"] as const).map((provider) => ({
      provider,
      connected: connected.has(provider),
      ...(loginErrors.has(provider)
        ? { error: loginErrors.get(provider) }
        : {}),
    }));
  };
  const settled = (entries = plans()): Connection =>
    entries.some((plan) => plan.connected)
      ? {
          kind: "connected",
          model: defaultPlanModel(models, planAvailability).modelId,
        }
      : {
          kind: "disconnected",
          message: "Connect your ChatGPT or Claude subscription to start.",
        };
  let state: Connection = {
    kind: "disconnected",
    message: "Connect your ChatGPT or Claude subscription to start.",
  };
  let reply: ((value: string) => void) | undefined;
  let login: Promise<void> | undefined;
  const controller = new AbortController();
  return {
    models,
    planAvailability,
    store,
    async initialise(importPi = true) {
      if (importPi && !(await store.read("openai-codex"))) {
        try {
          const existing = z
            .record(z.string(), z.unknown())
            .parse(
              JSON.parse(
                await readFile(join(homedir(), ".pi/agent/auth.json"), "utf8"),
              ),
            );
          const credential = OAuth.safeParse(existing["openai-codex"]);
          if (credential.success)
            await store.modify("openai-codex", async () => credential.data);
        } catch {
          /* Missing or incompatible Pi credentials require login. */
        }
      }
      if (await models.checkAuth("openai-codex")) state = settled();
    },
    status: (): Connection => {
      const entries = plans();
      const current =
        state.kind === "connecting"
          ? state
          : entries.some((plan) => plan.connected) || state.kind === "connected"
            ? settled(entries)
            : state;
      return { ...current, plans: entries };
    },
    async disconnect(provider: PlanProvider) {
      if (login)
        throw new Error("Finish signing in before disconnecting a plan.");
      await models.logout(provider);
      loginErrors.delete(provider);
      state = settled();
    },
    connect(provider: PlanProvider = "openai-codex") {
      if (lease) {
        loginErrors.set(provider, "Sign-in is off in this test copy. It uses the owner's plan.");
        return;
      }
      if (login) return;
      loginErrors.delete(provider);
      state = { kind: "connecting", provider };
      login = models
        .login(provider, "oauth", {
          signal: controller.signal,
          async prompt(prompt) {
            if (prompt.type === "select") return "browser";
            return new Promise<string>((resolve, reject) => {
              reply = resolve;
              state = { ...state, kind: "connecting", prompt: prompt.message };
              const signal = prompt.signal ?? controller.signal;
              signal.addEventListener(
                "abort",
                () => {
                  reply = undefined;
                  reject(new Error("Cancelled"));
                },
                { once: true },
              );
            });
          },
          notify(event) {
            if (event.type === "auth_url")
              state = { kind: "connecting", provider, url: event.url };
          },
        })
        .then(() => {
          reply = undefined;
          state = settled();
        })
        .catch(() => {
          reply = undefined;
          const message = `${provider === "anthropic" ? "Claude" : "ChatGPT"} sign-in did not complete. Try connecting again.`;
          loginErrors.set(provider, message);
          state = { kind: "disconnected", message };
        })
        .finally(() => {
          login = undefined;
        });
    },
    reply(value: string) {
      reply?.(value);
      reply = undefined;
    },
    async close() {
      controller.abort();
      await login;
      await queue;
    },
  };
}
