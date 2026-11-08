throw new Error("This unsafe live fixture is retired. Use the stopped-owner plan lease in docs/plan-lease.md.");

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomInt } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { createAuth } from "../../../core/auth.ts";
import { createPi } from "../../../apps/server/pi.ts";
import { createChatServer, openDatabase } from "../../../apps/server/server.ts";
import { webResource } from "../../../core/web.ts";

process.umask(0o077);
const source = resolve(process.cwd());
const directory = resolve("data/verification/four-profiles/live-fixture");
const port = 4327;
const visualCode = String(randomInt(1000, 10000));
const origin = `http://127.0.0.1:${port}`;
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(join(directory, "visual-challenge.json"), JSON.stringify({ code: visualCode }));
const credentialDb = new DatabaseSync(join(source, "data/credentials/oauth.sqlite"));
const auth = createAuth(credentialDb);
await auth.initialise(false);
if (auth.status().kind !== "connected") throw new Error("Existing subscription connection is unavailable.");
const release = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
let closing = false;
const adapter = await createPi(join(directory, "pi.sqlite"), auth, [], {}, {
  experiencesEnabled: true,
  tools: {
    receiptDirectory: join(directory, "tool-receipts"),
    generation: "isolated-live-acceptance",
    mode: "stable",
    enabled: () => !closing,
  },
});
await adapter.configure?.("gpt-6.1-sol", "high");
const app = createChatServer({ db: await openDatabase(directory), adapter, auth, origins: [origin] });
const handlers = app.server.listeners("request");
app.server.removeAllListeners("request");
app.server.on("request", async (req, res) => {
  try {
    const path = new URL(req.url ?? "/", origin).pathname;
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) {
      res.writeHead(403); res.end(); return;
    }
    const html = (body: string) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(`<!doctype html><html><head><title>Owned Gaia acceptance</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:18px system-ui;background:#151515;color:#eee;margin:64px}main{max-width:540px}label{display:block;margin:30px 0 8px}input,button{font:inherit;border:1px solid #777;border-radius:10px;padding:14px;color:inherit;background:#252525}button{margin-top:22px;display:block}</style></head><body><main>${body}</main></body></html>`);
    };
    if (path === "/qa/owned-form") {
      if (req.method === "POST") {
        let body = "";
        for await (const chunk of req) { body += chunk; if (body.length > 4000) throw new Error("Fixture input too long"); }
        const value = new URLSearchParams(body).get("message") ?? "";
        await writeFile(join(directory, "form-receipt.json"), JSON.stringify({ value, at: new Date().toISOString() }));
        html("<h1>Saved</h1><p>The owned test form was submitted.</p>");
      } else html(`<canvas width="340" height="100" aria-label="Visual test card"></canvas><script>const c=document.querySelector("canvas").getContext("2d");c.fillStyle="#f4f0e8";c.fillRect(0,0,340,100);c.fillStyle="#167aaf";c.fillRect(14,14,72,72);c.fillStyle="#171717";c.font="bold 48px monospace";c.fillText("${visualCode}",112,68);</script><h1>Gaia desktop test</h1><p>This form only writes a local acceptance receipt.</p><form method="post"><label for="message">Test message</label><input id="message" name="message" autocomplete="off"><button type="submit">Save test message</button></form>`);
      return;
    }
    if (path === "/qa/webhook" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) { body += chunk; if (body.length > 4000) throw new Error("Fixture input too long"); }
      const value = JSON.parse(body);
      await writeFile(join(directory, "webhook-receipt.json"), JSON.stringify({ value, at: new Date().toISOString() }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, nonce: value.nonce })); return;
    }
    if (req.method === "GET" && !path.startsWith("/api/") && path !== "/healthz") {
      const resource = await webResource(path, { data: directory, release, directory: source });
      res.writeHead(resource.status, { "Content-Type": resource.type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(resource.body); return;
    }
    for (const handler of handlers) handler.call(app.server, req, res);
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Owned acceptance fixture failed." }));
  }
});
await new Promise<void>((done) => app.server.listen(port, "127.0.0.1", done));
await writeFile(join(directory, "server.json"), JSON.stringify({ pid: process.pid, origin, source: release, directory, credentialCapability: "original protected OAuth store, no copied credentials" }, null, 2));
console.log(`Isolated live acceptance ${origin}, source ${release}`);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  if (closing) return;
  closing = true;
  void app.close().then(() => { credentialDb.close(); process.exit(0); }, () => process.exit(1));
});
