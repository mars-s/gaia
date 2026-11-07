import { join } from "node:path";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { Thread } from "../../packages/protocol/index.ts";
import { webResource } from "../web.ts";
const [stage, scratch, portText, scenario, webroot] = process.argv.slice(2);
const origin = `http://127.0.0.1:${Number(portText)}`;
const { createAuth }: typeof import("../../apps/server/auth.ts") = await import(join(stage, "apps/server/auth.ts"));
const { createPi }: typeof import("../../apps/server/pi.ts") = await import(join(stage, "apps/server/pi.ts"));
const { openDatabase, createChatServer }: typeof import("../../apps/server/server.ts") = await import(join(stage, "apps/server/server.ts"));
const db = await openDatabase(scratch), auth = createAuth(db);
const faux = fauxProvider({ provider: "openai-codex", models: [{ id: "gpt-6.1-sol", reasoning: true }], tokensPerSecond: 100000 });
auth.models.setProvider(faux.provider); auth.planAvailability.connectedProviders = () => new Set(["openai-codex"]);
const pi = await createPi(join(scratch, "pi.sqlite"), auth, [], {}, { experiencesEnabled: true });
const answer = scenario === "proposal" ? "Here is a setup with a Bot for each part of your day. You can review it below." : "## A calmer week\n\nKeep the plan small enough to use every day.\n\n### Three useful steps\n\n1. Choose one important task.\n2. Leave space for lunch.\n3. Review what changed.\n\n```typescript\nconst week = { focus: 'Finish the draft' };\n```\n\nThe [TypeScript handbook](https://www.typescriptlang.org/docs/handbook/intro.html) covers the types.";
const thread = Thread.parse({ version: 1, id: "local", messages: ["answer", "proposal", "failed"].includes(scenario) ? [{ id: "fixture-user", role: "user", text: "Help me plan the week.", createdAt: "2026-11-05T00:00:00.000Z" }, ...(scenario === "failed" ? [] : [{ id: "fixture-answer", role: "assistant", text: answer, createdAt: "2026-11-05T00:00:01.000Z" }])] : [], run: scenario === "failed" ? { kind: "error", message: "The reply could not finish. Try again when ready." } : { kind: "idle" } });
db.exec("CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)");
db.prepare("INSERT OR REPLACE INTO chat VALUES (1,?)").run(JSON.stringify(thread));
if (["proposal", "setups"].includes(scenario)) {
  for (const layout of (scenario === "setups" ? ["bots", "channels", "sessions"] as const : ["bots"] as const)) {
    const proposal = await pi.experiences!.create({ requestId: crypto.randomUUID(), plan: { layout, title: layout === "bots" ? "Everyday Bots" : layout === "channels" ? "Shared workspace" : "My sessions", assistantName: "Gaia", purpose: "A simple place for everyday work.", scopes: [{ label: "Home", purpose: "Plan the day.", avatar: "bot-01" }, { label: "Study", purpose: "Make time for learning.", avatar: "bot-02" }, { label: "Work", purpose: "Prepare clear reports.", avatar: "bot-03" }] } }, { source: { kind: "conversation", conversationId: "original" }, answerMessageId: "fixture-answer" });
    if (scenario === "setups") {
      await (await pi.experiences!.resolve(proposal.id)).confirm(proposal.revision);
      faux.setResponses([fauxAssistantMessage("What would you like to focus on?")]);
    }
  }
}
const app = createChatServer({ db, adapter: pi, origins: [origin], auth: { status: () => ({ kind: "connected", model: "gpt-6.1-sol" }), connect() {}, reply() {}, close: () => auth.close() } });
const handlers = app.server.listeners("request"); app.server.removeAllListeners("request");
app.server.on("request", async (req, res) => {
  const path = new URL(req.url ?? "/", origin).pathname;
  if (req.method === "GET" && !path.startsWith("/api/") && path !== "/healthz") {
    const resource = await webResource(path, { data: scratch, release: "0".repeat(40), directory: webroot });
    res.writeHead(resource.status, { "Content-Type": resource.type }); res.end(resource.body); return;
  }
  for (const handler of handlers) handler.call(app.server, req, res);
});
await new Promise<void>((resolve, reject) => { app.server.once("error", reject); app.server.listen(Number(portText), "127.0.0.1", resolve); });
process.stdout.write("FIXTURE_READY\n");
