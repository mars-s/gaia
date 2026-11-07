import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { command } from "../../core/process.ts";

// Each bad page changes one rule of the otherwise readable, labelled fixture.
const cases = [
  ["painted background", '<span style="background:linear-gradient(black,black);color:white">Task</span>', "light", null],
  ["transparent background", '<div style="background:rgba(0,0,0,.5)"><span style="color:#999">Task</span></div>', "light", "contrast"],
  ["inline sentence", '<p>Check your plan in <button style="display:inline;width:auto;height:auto;padding:0;border:0">Settings</button>.</p>', "light", null],
  ["standalone inline target", '<div><button style="display:inline;width:12px;height:12px;padding:0">A</button></div>', "light", "target"],
  ["current contract", '<button data-ui="action" data-variant="primary">Add task</button><label>Task <input></label>', "light", null],
  ["second primary", '<button data-ui="action" data-variant="primary">Add</button><button data-ui="action" data-variant="primary">Save</button>', "light", "primary"],
  ["overflow", '<div style="width:400px">Wide task list</div>', "light", "overflow"],
  ["clipped label", '<div style="width:20px;overflow:hidden;white-space:nowrap">Important task name</div>', "light", "Clipped"],
  ["dark light box", '<div style="width:100px;height:100px;background:white;color:black">Tasks</div>', "dark", "Light box"],
  ["contrast", '<span style="color:#eee">Unreadable task</span>', "light", "contrast"],
  ["button name", '<button><svg></svg></button>', "light", "button-name"],
  ["field label", '<input>', "light", "label"],
  ["link name", '<a href="/tasks" style="display:block;width:32px;height:32px"></a>', "light", "link-name"],
  ["ARIA target", '<button aria-labelledby="missing">Open</button>', "light", "Missing aria-labelledby"],
  ["small target", '<button style="width:12px;height:12px;padding:0">A</button>', "light", "target"],
  ["empty state", '<section data-preview-surface="tasks"><p>Ready</p></section>', "light", "empty-state", "empty"],
  ["loading state", '<section data-preview-surface="tasks"><p>Ready</p></section>', "light", "loading", "loading"],
  ["error state", '<section data-preview-surface="tasks"><p>Ready</p></section>', "light", "notice", "error"],
];
test("rendered guardrails reject every planted bad page and account for non-solid contrast", { timeout: 60000 }, async () => {
  const dir = await mkdtemp("/private/tmp/gaia-render-checks-");
  try {
    const audit = await readFile("core/render/checks.mjs", "utf8");
    const require = createRequire(import.meta.url);
    const script = join(dir, "test.cjs");
    const axe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
    await writeFile(script, `const {app,BrowserWindow}=require('electron');app.setActivationPolicy('prohibited');app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{app.dock?.hide();const window=new BrowserWindow({show:false,focusable:false,width:320,height:700,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});const results=[];
for(const [name,html,theme,expected,state] of ${JSON.stringify(cases)}){
await window.loadURL('data:text/html,'+encodeURIComponent('<html class="'+theme+'"><body style="margin:0;background:'+(theme==='dark'?'#121212':'white')+';color:'+(theme==='dark'?'white':'black')+';font:14px Arial"><style>button,input{width:32px;height:32px}button{font:inherit}</style>'+html+'</body></html>'));
await window.webContents.executeJavaScriptInIsolatedWorld(999,[{code:${JSON.stringify(axe)}}]);
const report=await window.webContents.executeJavaScriptInIsolatedWorld(999,[{code:${JSON.stringify(audit.replace("export async function", "async function"))}+';auditPage('+JSON.stringify(state)+',"tasks")'}]);results.push({name,expected,report});}
process.stdout.write(JSON.stringify(results));window.destroy();app.quit();}).catch(e=>{process.stderr.write(String(e.stack));app.exit(1)});`);
    const output = await command(require("electron"), [script, `--user-data-dir=${join(dir, "profile")}`], dir, 55000);
    const results: { name: string; expected: string | null; report: { failures: string[]; contrast: {skipped?: string}[]; incomplete: {skipped?:string}[] } }[] = JSON.parse(output);
    assert.equal(results.length, cases.length);
    assert(results[0].report.contrast.some(node => node.skipped?.includes("gradient")), "non-solid node exemption is explicit");
    for (const result of results) {
      if (result.expected) assert(result.report.failures.some(message => message.includes(result.expected!)), `${result.name}: ${result.report.failures.join("\n")}`);
      else assert.deepEqual(result.report.failures, [], result.name);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
