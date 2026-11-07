import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { designPack, DesignTurns } from "./design/pack.ts";

test("the protected pack lists actual kit exports, descriptions, examples and fixed choices", async () => {
  const pack = await designPack(resolve("."), resolve("."));
  for (const name of ["Action", "Menu", "Preview", "Checkbox", "@example", "bot-00", "SPEC.md", "apps/web/surfaces/<name>/", "apps/web/proposal-card.tsx"]) assert(pack.includes(name), name);
  const human = await readFile("DESIGN.md", "utf8");
  for (const token of new Set(human.match(/--color-[a-z0-9-]+/g))) assert(pack.includes(token), token);
  for (const button of ["primary-action", "secondary-action", "quiet-action", "inline-link"]) assert(pack.includes(button));
  assert.equal((await readFile("core/design/rubric-compact.md", "utf8")).trim().split("\n").length, 10);
});
test("inventory follows new exports and refuses escaping module paths", async () => {
  const root = await mkdtemp("/private/tmp/gaia-pack-");
  try {
    await mkdir(join(root, "apps/web"), { recursive: true });
    await cp("apps/web/ui", join(root, "apps/web/ui"), { recursive: true });
    const path = join(root, "apps/web/ui/index.ts");
    const index = await readFile(path, "utf8");
    await writeFile(path, index+'\nexport { NewPart } from "./new-part";');
    await writeFile(join(root, "apps/web/ui/new-part.tsx"), '/** A fresh part. @example <NewPart /> */\nexport function NewPart() { return null; }');
    assert.match(await designPack(root, resolve(".")), /NewPart: A fresh part/);
    await writeFile(path, 'export { Bad } from "../../../../core/tools";');
    await assert.rejects(designPack(root, resolve(".")), /Invalid UI kit export path/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("a design pack loads once in a turn, independently across conversations and new turns", () => {
  const turns = new DesignTurns();
  assert(turns.first("a", "turn1")); assert(!turns.first("a", "turn1"));
  assert(turns.first("b", "turn1")); assert(turns.first("a", "turn2"));
  turns.forget("a"); assert(turns.first("a", "turn2"));
});

test("real Pi tool results include the pack once per owner turn and explicit design remains available", async () => {
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
    if (input.kind === "design") packs++;
    response.end(JSON.stringify(input.kind === "design" ? { design: "PROTECTED_DESIGN_PACK" } : { text: "fixture source" }));
  });
  const socket = join(root, "control.sock");
  await new Promise<void>(resolve => server.listen(socket, resolve));
  const db = new DatabaseSync(join(root, "auth.sqlite")); const auth = createAuth(db);
  const faux = fauxProvider({ provider: "openai-codex", models: [{ id: "gpt-6.1-sol" }], tokensPerSecond: 100000 });
  auth.models.setProvider(faux.provider); auth.planAvailability.connectedProviders = () => new Set(["openai-codex"]);
  const pi = await createPi(join(root, "pi.sqlite"), auth, [selfChangeTools(socket)]);
  const call = (command: unknown) => fauxAssistantMessage(fauxToolCall("self_change", { command: JSON.stringify(command) }), { stopReason: "toolUse" });
  try {
    faux.setResponses([call({ kind: "read", path: "apps/server/server.ts" }), call({ kind: "read", path: "apps/web/app.tsx" }), call({ kind: "stage", reason: "fixture", edits: [{ path: "apps/web/app.tsx", find: "a", replace: "b" }] }), call({ kind: "design" }), fauxAssistantMessage("Done")]);
    await pi.run({ text: "Read and stage the UI", requestId: randomUUID(), onText() {}, signal: new AbortController().signal });
    assert.equal(packs, 2, "one automatic pack plus one explicit design command");
    faux.setResponses([call({ kind: "read", path: "apps/web/app.tsx" }), fauxAssistantMessage("Done")]);
    await pi.run({ text: "Read the UI again", requestId: randomUUID(), onText() {}, signal: new AbortController().signal });
    assert.equal(packs, 3, "a new owner turn gets a fresh pack");
  } finally { await pi.close(); auth.close(); db.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});

test("a successful UI stage still returns its id when automatic design attachment fails", async () => {
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
    if (input.kind === "design") { packs++; response.writeHead(409); response.end(JSON.stringify({error:"BROKEN_PACK"})); return; }
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
    faux.setResponses([call({ kind: "stage", reason: "fixture", edits: [{ path: "apps/web/app.tsx", text: "changed" }] }), context => {
      const transcript = JSON.stringify(context);
      assert(transcript.includes("08c519e7-e982-45fa-ac70-1fe245b20c77"));
      assert(transcript.includes("designError"));
      return fauxAssistantMessage("Stage created");
    }]);
    await pi.run({ text: "Stage the UI", requestId: randomUUID(), onText() {}, signal: new AbortController().signal });
    assert.equal(packs, 1);
  } finally { await pi.close(); auth.close(); db.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});
