import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { renderCandidate, renderProfile } from "../../core/render/index.ts";
import { command } from "../../core/process.ts";
import { freePort } from "../../core/sandbox.ts";
import { z } from "zod";

test("the real protected renderer captures all baseline variants hidden with fixture-only data", { skip: process.platform !== "darwin", timeout: 180000 }, async () => {
  const { scratch, results } = await renderCandidate({ stage: resolve("."), core: resolve("."), dependencies: resolve("node_modules") });
  try {
    const reports = z.array(z.object({ shots: z.array(z.object({ file: z.string(), width: z.number(), theme: z.string() })), audits: z.array(z.object({ incomplete: z.array(z.object({ skipped: z.string().optional() })) })), externalBlocked: z.literal(true), hidden: z.literal(true), errors: z.array(z.string()) })).parse(results);
    assert(reports.flatMap(report => report.audits.flatMap(audit => audit.incomplete)).some(node => node.skipped?.includes("partly obscured")), "real scrolled text cannot claim an ancestor-only contrast ratio");
    assert.equal(reports.length, 5); assert.equal(reports.flatMap(report => report.shots).length, 20);
    for (const [index, scenario] of ["empty", "answer", "proposal", "setups", "failed"].entries()) {
      assert.deepEqual(reports[index].errors, []);
      for (const shot of reports[index].shots) assert((await readFile(join(scratch, scenario, shot.file))).length > 1000);
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
test("the renderer fails closed on an invalid sandbox and its profile cannot grant outside writes", { skip: process.platform !== "darwin" }, async () => {
  const data = await mkdtemp("/private/tmp/gaia-render-policy-");
  try {
    await mkdir(join(data, ".sandbox-profiles"));
    // Production generation runs real denied-read, denied-policy-write and denied-network proofs before returning.
    const { policy, trusted } = await renderProfile(resolve("."), resolve("."), resolve("node_modules"), data, await freePort());
    try {
      const text = await readFile(policy, "utf8");
      assert.doesNotMatch(text, /localhost:\*/); assert.match(text, /\(deny default\)/);
      await writeFile(policy, "INVALID_SANDBOX_PROFILE");
      await assert.rejects(command("/usr/bin/sandbox-exec", ["-f", policy, process.execPath, "-e", "process.exit(0)"], data), /failed/);
    } finally { await rm(trusted, { recursive: true, force: true }); }
  } finally { await rm(data, { recursive: true, force: true }); }
});

test("declared surfaces force their own states and source defects cannot bypass trusted checks", { skip: process.platform !== "darwin", timeout: 180000 }, async () => {
  const { cp, symlink } = await import("node:fs/promises");
  const { Surfaces } = await import("../../core/render/schema.ts");
  const { importable } = await import("../../core/install.ts");
  const stage = await mkdtemp("/private/tmp/gaia-render-surface-");
  const dependencies = resolve("node_modules");
  try {
    for (const path of ["apps", "packages", "core", "package.json", "tsconfig.json", "dist/web"]) await cp(resolve(path), join(stage, path), { recursive: true, filter: importable });
    await symlink(dependencies, join(stage, "node_modules"));
    const appPath = join(stage, "apps/web/main.tsx"), original = await readFile(appPath, "utf8");
    await mkdir(join(stage, "apps/web/surfaces/tasks"), { recursive: true });
    const surfacePath = join(stage, "apps/web/surfaces/tasks/index.tsx");
    await writeFile(join(stage, "apps/web/surfaces/tasks/enter.css"), "@keyframes planted-enter { from { opacity:0 } to { opacity:1 } } .test-enter { animation:planted-enter 30s both; }");
    await writeFile(surfacePath, `import './enter.css'; import {useState} from 'react'; import {usePreviewState,Loading,TextField,Action} from '../../ui'; export default function Tasks(){const state=usePreviewState('filled');const [opened,open]=useState(false);const [value,setValue]=useState('');const [title,setTitle]=useState('Tasks');return <><Action variant='secondary' style={{position:'fixed',right:16,top:56}} onClick={()=>open(true)}>Open tasks</Action>{opened&&<section className="test-enter" style={{position:'fixed',left:20,top:120,width:240,background:'var(--color-surface-page)',color:'var(--color-ink)'}}><TextField aria-label='Filter tasks' onChange={event=>setValue(event.target.value)}/><Action variant='secondary' onClick={()=>setTitle(value)}>View tasks</Action><h2>{title}</h2>{state==='empty'?<div data-ui="empty-state">No tasks yet.</div>:state==='loading'?<Loading/>:state==='error'?<div data-ui="notice" data-tone="danger">Couldn’t load tasks.</div>:<p>One task</p>}</section>}</>}`);
    await writeFile(appPath, 'window.alert("PLANTED_DIALOG_MUST_STAY_HIDDEN"); import Tasks from "./surfaces/tasks";\n'+original.replace('<App />','<App /><Tasks />'));
    const surfaces = Surfaces.parse([{ name: "tasks", steps: [{kind:"click",role:"button",name:"Open tasks"},{kind:"type",role:"textbox",name:"Filter tasks",text:"Read documentation"},{kind:"click",role:"button",name:"View tasks"},{kind:"wait",role:"heading",name:"Read documentation"},{kind:"press",key:"Escape"}] }]);
    for (const bad of [[{ name: "tasks", steps: [{ kind: "evaluate", code: "process.exit()" }] }]]) assert(!Surfaces.safeParse(bad).success);
    const good = await renderCandidate({ stage, core: resolve("."), dependencies, surfaces });
    const reports = z.array(z.object({ shots: z.array(z.unknown()), audits: z.array(z.object({state:z.string(),failures:z.array(z.string()),contrast:z.array(z.object({skipped:z.string().optional()})),incomplete:z.array(z.object({ratio:z.number().optional(),skipped:z.string().optional()}))})) })).parse(good.results);
    assert(reports.every(report=>report.audits.every(audit=>audit.contrast.every(node=>!node.skipped?.includes("Opacity applies")))), "finite entrance animations must reach their painted end state before checks and capture");
    assert.equal(reports.flatMap(report=>report.shots).length,24);
    assert.equal(reports.at(-1)?.audits.length,16);
    for(const report of reports) for(const audit of report.audits) { assert.deepEqual(audit.failures,[]); for(const node of audit.incomplete) assert(node.ratio !== undefined || node.skipped); }
    await writeFile(surfacePath, `export default function Tasks(){return <section><h2>Tasks</h2></section>}`);
    await assert.rejects(renderCandidate({stage,core:resolve("."),dependencies,surfaces:[{name:"tasks",steps:[]}]}), /Missing required state.*empty-state/);
    await writeFile(appPath, 'console.error("PLANTED_PAGE_CONSOLE_ERROR");\n'+original);
    await assert.rejects(renderCandidate({stage,core:resolve("."),dependencies}), /PLANTED_PAGE_CONSOLE_ERROR/);
    await writeFile(appPath, 'throw new Error("PLANTED_PAGE_EXCEPTION");\n'+original);
    await assert.rejects(renderCandidate({stage,core:resolve("."),dependencies}), /PLANTED_PAGE_EXCEPTION/);
  } finally { await rm(stage, { recursive: true, force: true }); }
});

test("a native renderer crash exits directly while its window stays offscreen", {skip:process.platform!=="darwin",timeout:40000}, async () => {
  const {cp,symlink,readdir} = await import("node:fs/promises");
  const {randomUUID} = await import("node:crypto");
  const trusted = await mkdtemp("/private/tmp/gaia-render-crash-");
  const nonce=randomUUID();
  try {
    for(const path of ["core","packages/protocol","package.json","tsconfig.json"]) await cp(resolve(path),join(trusted,path),{recursive:true});
    await symlink(resolve("node_modules"),join(trusted,"node_modules"));
    const browser=join(trusted,"core/render/browser.mjs"),source=await readFile(browser,"utf8");
    const probe=`const marker=job.scratch+'/renderer-pid.json'; fs.writeFileSync(marker+'.new',JSON.stringify({rendererPid:window.webContents.getOSProcessId(),browserPid:process.pid,nonce:${JSON.stringify(nonce)}})); fs.renameSync(marker+'.new',marker); await new Promise(resolve=>setTimeout(resolve,10000));`;
    assert(source.includes('await window.webContents.debugger.sendCommand("Runtime.enable");'));
    await writeFile(browser,source.replace('await window.webContents.debugger.sendCommand("Runtime.enable");',probe));
    const started=Date.now(); let finished=false,killed=false;
    const run=renderCandidate({stage:resolve("."),core:trusted,dependencies:resolve("node_modules")}).then(()=>{finished=true;return null;},error=>{finished=true;return error;});
    while(!finished&&!killed&&Date.now()-started<25000) {
      for(const entry of await readdir(join(trusted,".sandbox-profiles")).catch(()=>[])) {
        const job=await readFile(join(trusted,".sandbox-profiles",entry,"job.json"),"utf8").then(text=>JSON.parse(text)).catch(()=>null); if(!job)continue;
        const data=z.object({scratch:z.string()}).parse(job);
        const raw=await readFile(join(data.scratch,"renderer-pid.json"),"utf8").catch(()=>null); if(!raw)continue;
        const pid=z.object({rendererPid:z.number().int().positive(),browserPid:z.number().int().positive(),nonce:z.literal(nonce)}).parse(JSON.parse(raw));
        assert.equal(await command("/bin/ps",["-p",String(pid.rendererPid),"-o","ppid="],trusted),String(pid.browserPid));
        assert((await command("/bin/ps",["-p",String(pid.browserPid),"-o","args="],trusted)).includes(browser));
        process.kill(pid.rendererPid,"SIGKILL"); killed=true; break;
      }
      if(!killed)await new Promise(resolve=>setTimeout(resolve,30));
    }
    const error=await run; assert(killed,"the test must stop only its verified renderer child");
    assert(error instanceof Error); assert.match(error.message,/Native renderer exited: (killed|crashed)/);
    assert(Date.now()-started<25000,"the crash must not wait for an Electron error dialog or the guardian deadline");
  } finally {await rm(trusted,{recursive:true,force:true});}
});
