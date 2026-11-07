import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, symlink, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Supervisor } from "./supervisor.ts";
import { Change, Command } from "./state.ts";
import { command } from "./process.ts";
import { hashes, importable } from "./install.ts";
import { selfChangeTools } from "./tools.ts";
import { createAuth } from "./auth.ts";
import { createPi } from "../apps/server/pi.ts";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";

test("four planted UI changes fail trusted gates and readable file and rule details reach the Pi agent", { skip: process.platform !== "darwin", timeout: 240000 }, async t => {
  const data = await mkdtemp("/private/tmp/gaia-ui-negative-"), repo = join(data, "repo");
  const receipts: { change: string; path: string; detail: string }[] = [];
  try {
    await mkdir(repo);
    for (const path of ["apps", "packages", "core", "selfmod", "package.json", "package-lock.json", "tsconfig.json", "eslint.config.js", "vite.config.ts", "LICENSE"]) await cp(resolve(path), join(repo, path), { recursive: true, filter: importable });
    for (const args of [["init", "-q"], ["config", "user.email", "gaia@localhost"], ["config", "user.name", "Gaia test"], ["add", "."], ["commit", "-qm", "fixture"]]) await command("git", args, repo);
    const release = await command("git", ["rev-parse", "HEAD"], repo), active = join(data, "releases", release);
    await symlink(resolve("node_modules"), join(repo, "node_modules"));
    await mkdir(join(data, "releases")); await command("git", ["worktree", "add", "--detach", active, release], repo);
    await symlink(resolve("node_modules"), join(active, "node_modules"));
    const supervisor = new Supervisor({ data, core: resolve("."), dependencies: resolve("node_modules"), host: "127.0.0.1", port: 0, testProvider: true });
    Object.assign(supervisor, { protected: await hashes(repo) });
    const pair = { release, generation: randomUUID(), schema: 1 as const };
    supervisor.state = { kind: "stable", active: pair, good: pair, failures: 0 };
    const controlServer = createServer(async (request, response) => {
      let body = ""; for await (const chunk of request) body += chunk;
      try { response.end(JSON.stringify(await supervisor.handle(Command.parse(JSON.parse(body))))); }
      catch (error) { response.writeHead(409); response.end(JSON.stringify({ error: String(error) })); }
    });
    const socket = join(data, "agent.sock"); await new Promise<void>(resolve => controlServer.listen(socket, resolve));
    const db = new DatabaseSync(join(data, "fixture-auth.sqlite")), auth = createAuth(db);
    const faux = fauxProvider({ provider: "openai-codex", models: [{ id: "gpt-6.1-sol" }], tokensPerSecond: 100000 });
    auth.models.setProvider(faux.provider); auth.planAvailability.connectedProviders = () => new Set(["openai-codex"]);
    const pi = await createPi(join(data, "fixture-pi.sqlite"), auth, [selfChangeTools(socket)]);
    try {
      const ui = "apps/web/ui/ui.css", original = await readFile(join(repo, ui), "utf8"), app = await readFile(join(repo, "apps/web/app.tsx"), "utf8");
      const cases = [
        { name: "raw hex colour", path: "apps/web/planted.css", text: ".planted { color: #123456; }", rule: /\[2\].*planted.css/, render: false },
        { name: "raw button", path: "apps/web/planted.tsx", text: "export const Bad = () => <button>Bad</button>;", rule: /\[4\].*planted.tsx/, render: false },
        { name: "320 px overflow", path: ui, text: original + "\nhtml { min-width: 500px; }", rule: /Page overflow at 320 px/, render: true },
        { name: "light box in dark mode", path: "apps/web/app.tsx", text: app.replace('<div className="app-shell', '<div style={{background:"var(--color-primary-ink)"}} className="app-shell'), rule: /Light box in dark theme/, render: true },
      ];
      for (const planted of cases) {
        const change = Change.parse(await supervisor.handle({ kind: "stage", reason: planted.name, edits: [{ path: planted.path, text: planted.text }] }));
        let detail: string;
        if (planted.render) {
          await assert.rejects(supervisor.handle({ kind: "preview", id: change.id, surfaces: [] }), planted.rule);
          detail = supervisor.history.find(entry => entry.id === change.id)!.checks.join("\n");
        } else {
          await supervisor.handle({ kind: "preview", id: change.id, surfaces: [] });
          await supervisor.handle({ kind: "submit", id: change.id });
          const deadline = Date.now() + 90000;
          while (supervisor.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
          const entry = supervisor.history.find(entry => entry.id === change.id)!;
          assert.equal(entry.outcome, "rejected", entry.detail);
          detail = entry.checks.join("\n");
        }
        assert.match(detail, planted.rule); assert(detail.includes(planted.path.replace("apps/web/", "")), detail);
        faux.setResponses([fauxAssistantMessage(fauxToolCall("self_change", { command: JSON.stringify({ kind: "history" }) }), { stopReason: "toolUse" }), context => {
          const seen = JSON.stringify(context.messages); assert.match(seen, planted.rule); assert(seen.includes(planted.path.replace("apps/web/", "")));
          return fauxAssistantMessage("The trusted check rejected the planted change. I can read the file and rule.");
        }]);
        let answer = "";
        await pi.run({ text: "Read the failed check", requestId: randomUUID(), onText: text => { answer = text; }, signal: new AbortController().signal });
        assert.match(answer, /file and rule/);
        receipts.push({ change: planted.name, path: planted.path, detail });
        t.diagnostic(`${planted.name}: rejected with ${planted.path} and ${planted.rule.source}; delivered to the Pi agent`);
        assert.equal(supervisor.state.active.release, release); assert.equal(supervisor.child, undefined);
      }
    } finally { await pi.close(); await auth.close(); db.close(); await new Promise<void>(resolve => controlServer.close(() => resolve())); }
    await mkdir(resolve("data/verification/self-made-ui/phase-b2"), { recursive: true });
    await writeFile(resolve("data/verification/self-made-ui/phase-b2/bad-change-proofs.json"), JSON.stringify(receipts, null, 2));
    assert.equal(receipts.length, 4);
  } finally { await rm(data, { recursive: true, force: true }); }
});
