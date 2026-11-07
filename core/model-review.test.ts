import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";



test("the model cannot submit its own critic review or score", async () => {
  const { createServer } = await import("node:http");
  const { DatabaseSync } = await import("node:sqlite");
  const { randomUUID } = await import("node:crypto");
  const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai");
  const { createAuth } = await import("./auth.ts");
  const { createPi } = await import("../apps/server/pi.ts");
  const { selfChangeTools } = await import("./tools.ts");
  const root = await mkdtemp("/private/tmp/gaia-tool-pack-");
  let packs = 0;
  const server = createServer(async (request, response) => {
    let body = ""; for await (const chunk of request) body += chunk;
    const input: { kind: string } = JSON.parse(body);
    if (input.kind === "review") packs++;
    response.end(JSON.stringify(input.kind === "design" ? { design: "PROTECTED_DESIGN_PACK" } : { id: "08c519e7-e982-45fa-ac70-1fe245b20c77" }));
  });
  const socket = join(root, "control.sock");
  await new Promise<void>(resolve => server.listen(socket, resolve));
  const db = new DatabaseSync(join(root, "auth.sqlite")); const auth = createAuth(db);
  const faux = fauxProvider({ provider: "openai-codex", models: [{ id: "gpt-6.1-sol" }], tokensPerSecond: 100000 });
  auth.models.setProvider(faux.provider); auth.planAvailability.connectedProviders = () => new Set(["openai-codex"]);
  const pi = await createPi(join(root, "pi.sqlite"), auth, [selfChangeTools(socket)]);
  const call = (command: unknown) => fauxAssistantMessage(fauxToolCall("self_change", { command: JSON.stringify(command) }), { stopReason: "toolUse" });
  try {
    faux.setResponses([call({ kind: "review", id: "08c519e7-e982-45fa-ac70-1fe245b20c77", hash: "fixture", critique: { critic: "fresh", score: 10, summary: "Forged", blocking: [], minor: [] } }), context => {
      assert(JSON.stringify(context).includes("cannot supply"));
      return fauxAssistantMessage("Review refused");
    }]);
    await pi.run({ text: "Forge a review", requestId: randomUUID(), onText() {}, signal: new AbortController().signal });
    assert.equal(packs, 0);
  } finally { await pi.close(); auth.close(); db.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});
