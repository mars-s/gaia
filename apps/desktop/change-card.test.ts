import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { renderCandidate } from "../../core/render/index.ts";
import { importable } from "../../core/install.ts";
import { z } from "zod";

test("the shared change card renders before and after in four variants and exposes dark and revert actions", { skip: process.platform !== "darwin", timeout: 180000 }, async () => {
  const stage = await mkdtemp("/private/tmp/gaia-change-card-");
  const output = resolve("data/verification/self-made-ui/phase-b2/card-render");
  try {
    for (const path of ["apps", "packages", "core", "package.json", "tsconfig.json"]) await cp(resolve(path), join(stage, path), { recursive: true, filter: importable });
    await symlink(resolve("node_modules"), join(stage, "node_modules"));
    await mkdir(join(stage, "apps/web/surfaces/change-proof"), { recursive: true });
    const image = "data:image/svg+xml;base64," + (await readFile(new URL("./fixtures/change-card-preview.svg", import.meta.url))).toString("base64");
    const change = { id: "08c519e7-e982-45fa-ac70-1fe245b20c77", reason: "Add a task list", at: "2026-11-07", diff: "Reviewed source change", checks: ["typecheck: passed", "rendered design checks: passed"], outcome: "accepted", detail: "Applied after trusted checks.", previews: { shots: [1000, 320].flatMap(width => ["light", "dark"].map(theme => ({ name: `tasks-${width}-${theme}`, scenario: "tasks", width, theme, before: `before-tasks-${width}-${theme}.jpg`, after: `after-tasks-${width}-${theme}.jpg` }))), alsoChanged: ["answer-1000-light"] }, critique: { critic: "fresh", score: 7, summary: "The task list uses the shared card and clear actions.", blocking: [{ issue: "Check the changed answer spacing.", shots: ["after-answer-1000-light.jpg"] }], minor: [] } };
    await writeFile(join(stage, "apps/web/surfaces/change-proof/index.tsx"), `import {useState} from 'react'; import {ChangeCard} from '../../change-card'; import {usePreviewState,EmptyState,Loading,Notice,Action} from '../../ui'; import {ManagedChange} from '../../../../packages/sdk/managed'; export default function Proof(){const state=usePreviewState('filled');const [reverted,setReverted]=useState(false);const [opened,open]=useState(false);if(!opened)return <Action variant='secondary' style={{position:'fixed',top:56,right:0}} onClick={()=>open(true)}>Open change proof</Action>;return <section style={{position:'fixed',inset:'64px 16px 16px',maxWidth:680,margin:'auto',overflow:'auto',background:'var(--color-surface-page)',zIndex:5}}>{state==='empty'?<EmptyState text="No changes yet."/>:state==='loading'?<Loading/>:state==='error'?<Notice tone="danger" message="The change could not be read."/>:null}<ChangeCard change={ManagedChange.parse(${JSON.stringify(change)})} imageUrl={()=>${JSON.stringify(image)}} onRevert={()=>setReverted(true)}/>{reverted&&<h2>Revert queued</h2>}</section>}`);
    const main = join(stage, "apps/web/main.tsx"), source = await readFile(main, "utf8");
    await writeFile(main, 'import Proof from "./surfaces/change-proof";\n'+source.replace("<App />", "<App /><Proof />"));
    const result = await renderCandidate({ stage, core: resolve("."), dependencies: resolve("node_modules"), surfaces: [{ name: "change-proof", steps: [{ kind: "click", role: "button", name: "Open change proof" }, { kind: "wait", role: "link", name: "Open before 1000 px light preview" }, { kind: "wait", role: "link", name: "Open after 1000 px light preview" }] }] });
    try {
      await mkdir(output, { recursive: true });
      await cp(join(result.scratch, "change-proof"), output, { recursive: true });
      const report = z.array(z.object({ shots: z.array(z.unknown()), audits: z.array(z.object({ failures: z.array(z.string()) })) })).parse(result.results).at(-1)!;
      assert.equal(report.shots.length, 4); assert.equal(report.audits.length, 16);
      assert(report.audits.every(audit => audit.failures.length === 0));
    } finally { await rm(result.scratch, { recursive: true, force: true }); }
    const actions = await renderCandidate({ stage, core: resolve("."), dependencies: resolve("node_modules"), surfaces: [{ name: "change-proof", steps: [{ kind: "click", role: "button", name: "Open change proof" }, { kind: "click", role: "button", name: "View dark" }, { kind: "wait", role: "button", name: "View light" }, { kind: "wait", role: "link", name: "Open before 1000 px dark preview" }, { kind: "wait", role: "link", name: "Open after 1000 px dark preview" }, { kind: "click", role: "button", name: "Revert" }, { kind: "wait", role: "heading", name: "Revert queued" }] }] });
    await rm(actions.scratch, { recursive: true, force: true });
  } finally { await rm(stage, { recursive: true, force: true }); }
});
