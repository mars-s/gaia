import { Socket } from "node:net";
import tls from "node:tls";
import { mock } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  getCurrentTools,
  type FauxResponseFactory,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { createPi as actualCreatePi } from "../../apps/server/pi.ts";

// Loaded only by the synthetic release in child.test.ts, before auth initialises.
const networkAttempts: string[] = [];
function blocked(api: string): never {
  networkAttempts.push(api);
  throw new Error(`Installed-child fixture forbids outbound ${api}.`);
}
mock.method(globalThis, "fetch", () => blocked("fetch"));
mock.method(Socket.prototype, "connect", () => blocked("net.connect"));
mock.method(tls, "connect", () => blocked("tls.connect"));

const faux = fauxProvider({
  provider: "openai-codex",
  models: [{ id: "gpt-6.1-sol" }],
  tokensPerSecond: 100000,
});
const contexts: { messages: TranscriptContext["messages"]; tools: string[] }[] =
  [];
let aborted = 0;
const respond: FauxResponseFactory = async (context, options) => {
  contexts.push({
    messages: context.messages,
    tools: getCurrentTools(context.messages).map((tool) => tool.name),
  });
  const last = JSON.stringify(context.messages.at(-1));
  if (last.includes("SYNTHETIC_WAIT_FOR_ABORT")) {
    const signal = options?.signal;
    if (!signal) throw new Error("Expected Pi's provider abort signal.");
    await new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    aborted++;
    return fauxAssistantMessage("", { stopReason: "aborted" });
  }
  if (last.includes("SYNTHETIC_DEFERRED"))
    return fauxAssistantMessage("", {
      stopReason: "deferred",
      deferred: {
        id: "synthetic-installed-child-deferred",
        provider: "openai-codex",
        modelId: "gpt-6.1-sol",
        api: faux.api,
        pollAfterMs: 60000,
      },
    });
  return fauxAssistantMessage("Genuine installed-child faux Pi result.");
};
faux.setResponses(Array.from({ length: 8 }, () => respond));

const stats = () => ({ ...faux.state, contexts, aborted, networkAttempts });
process.on("message", (message) => {
  if (message === "faux-stats") process.send?.(stats());
});
process.once("exit", () => {
  const generation = process.env.GAIA_GENERATION;
  if (generation)
    writeFileSync(join(generation, "faux-exit.json"), JSON.stringify(stats()));
});

export const createPi: typeof actualCreatePi = (...args) => {
  args[1].models.setProvider({
    ...faux.provider,
    // The core auth check uses an OAuth row. Faux's stock resolver accepts API keys only.
    auth: {
      oauth: {
        name: "Synthetic OAuth for faux Pi only",
        async login() {
          return blocked("OAuth login");
        },
        async refresh() {
          return blocked("OAuth refresh");
        },
        async toAuth() {
          return {};
        },
      },
    },
  });
  return actualCreatePi(...args);
};
