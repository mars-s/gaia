import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createModels } from "@earendil-works/pi-ai/models";
import type { CredentialStore } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import type { Connection } from "../packages/protocol/index.ts";
const OAuth = z
  .object({
    type: z.literal("oauth"),
    access: z.string(),
    refresh: z.string(),
    expires: z.number(),
  })
  .catchall(z.unknown());
export function createAuth(db: DatabaseSync) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS credentials (provider TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  let queue: Promise<unknown> = Promise.resolve();
  const store: CredentialStore = {
    async read(provider) {
      const row = db
        .prepare("SELECT value FROM credentials WHERE provider=?")
        .get(provider);
      return row ? OAuth.parse(JSON.parse(String(row.value))) : undefined;
    },
    async list() {
      return (await store.read("openai-codex"))
        ? [{ providerId: "openai-codex", type: "oauth" }]
        : [];
    },
    modify(provider, fn) {
      const next = queue.then(async () => {
        const value = await fn(await store.read(provider));
        if (value)
          db.prepare("INSERT OR REPLACE INTO credentials VALUES (?,?)").run(
            provider,
            JSON.stringify(OAuth.parse(value)),
          );
        return value;
      });
      queue = next.catch(() => undefined);
      return next;
    },
    async delete(provider) {
      await queue;
      db.prepare("DELETE FROM credentials WHERE provider=?").run(provider);
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
  let state: Connection = {
    kind: "disconnected",
    message: "Connect your ChatGPT subscription to start.",
  };
  let reply: ((value: string) => void) | undefined;
  let login: Promise<void> | undefined;
  const controller = new AbortController();
  return {
    models,
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
      if (await models.checkAuth("openai-codex"))
        state = { kind: "connected", model: "gpt-6.1-sol" };
    },
    status: () => state,
    connect() {
      if (login) return;
      state = { kind: "connecting" };
      login = models
        .login("openai-codex", "oauth", {
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
              state = { kind: "connecting", url: event.url };
          },
        })
        .then(() => {
          reply = undefined;
          state = { kind: "connected", model: "gpt-6.1-sol" };
        })
        .catch(() => {
          reply = undefined;
          state = {
            kind: "disconnected",
            message: "ChatGPT sign-in did not complete. Try connecting again.",
          };
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
