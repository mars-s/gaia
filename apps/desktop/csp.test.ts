import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";

test("Chromium parses the shipped CSP without invalid sources and rejects a planted bad source", { timeout: 30000 }, async () => {
  const dir = await mkdtemp("/private/tmp/gaia-csp-");
  try {
    const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
    const policy = /content="([^"]+)"/.exec(html.slice(html.indexOf('http-equiv="Content-Security-Policy"')))?.[1];
    assert(policy);
    assert.match(policy, /default-src 'self'; script-src 'self'/);
    assert.doesNotMatch(policy, /(?:script-src|connect-src)[^;]*(?:'unsafe-eval'|https?:\/\/\*)/);
    const script = join(dir, "check.cjs");
    await writeFile(script, `const {app,BrowserWindow}=require('electron');
app.setActivationPolicy('prohibited');app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{app.dock?.hide();const results=[];
for(const policy of ${JSON.stringify([policy, policy.replace("connect-src 'self'", "connect-src 'self' ws://[::1]:*")])}){
const window=new BrowserWindow({show:false,focusable:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
const errors=[];window.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
await window.loadURL('data:text/html,'+encodeURIComponent('<meta http-equiv="Content-Security-Policy" content="'+policy+'"><p>Policy fixture</p>'));
results.push(errors);window.destroy();}
process.stdout.write(JSON.stringify(results));app.quit();}).catch(e=>{process.stderr.write(String(e));app.exit(1);});`);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const { stdout } = await promisify(execFile)(createRequire(import.meta.url)("electron"), [script, `--user-data-dir=${join(dir, "profile")}`], { env, timeout: 25000 });
    const results: string[][] = JSON.parse(stdout);
    assert.deepEqual(results[0], []);
    assert(results[1].some(message => message.includes("invalid source")));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
