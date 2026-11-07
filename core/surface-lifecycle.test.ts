import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { installCore, importBaseline } from "./install.ts";
import { Supervisor } from "./supervisor.ts";
import { Change, type Edit } from "./state.ts";
import { freePort } from "./sandbox.ts";

for (const surfaceCount of [1, 7])
  test(
    surfaceCount === 1
      ? "an accepted surface survives a server-only promotion and owner Revert"
      : "a seventh surface passes preview and trusted promotion",
    { skip: process.platform !== "darwin", timeout: 600000 },
    async (t) => {
      const root = await mkdtemp("/private/tmp/gaia-surface-lifecycle-");
      const data = join(root, "data"),
        core = join(root, "protected"),
        dependencies = resolve("node_modules");
      const supervisor = new Supervisor({
        data,
        core,
        dependencies,
        host: "127.0.0.1",
        port: await freePort(),
        testProvider: true,
      });
      const finish = async (entry: Change) => {
        const deadline = Date.now() + 360000;
        while (supervisor.busy && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 50));
        assert(!supervisor.busy, "promotion must settle");
        t.signal.throwIfAborted();
        const result = supervisor.history.find((item) => item.id === entry.id)!;
        assert.equal(
          result.outcome,
          "accepted",
          result.detail + result.checks.join("\n"),
        );
        assert.equal(supervisor.state.failures, 0);
        assert.deepEqual(
          (
            await readdir(join(data, "releases", result.commit!, "dist"))
          ).filter((name) => name.startsWith(".render-")),
          [],
        );
        return result;
      };
      try {
        for (const name of [
          "control",
          "credentials",
          "releases",
          "staging",
          "generations",
          "snapshots",
          "home",
        ])
          await mkdir(join(data, name), { recursive: true });
        await installCore(resolve("."), core, dependencies);
        await importBaseline(resolve("."), data, core, dependencies);
        await supervisor.open();
        t.signal.throwIfAborted();
        const active = join(data, "releases", supervisor.state.active.release);
        const original = await readFile(
          join(active, "apps/web/main.tsx"),
          "utf8",
        );
        const edits: Edit[] = [];
        let imports = "",
          mounts = "";
        for (let i = 0; i < surfaceCount; i++) {
          const name = `surface-${i}`;
          imports += `import Surface${i} from "./surfaces/${name}";\n`;
          mounts += `<Surface${i}/>`;
          edits.push({
            path: `apps/web/surfaces/${name}/render.json`,
            text: JSON.stringify({
              name,
              steps: [
                { kind: "click", role: "button", name: `Open surface ${i}` },
              ],
            }),
          });
          edits.push({
            path: `apps/web/surfaces/${name}/index.tsx`,
            text: `import {useState} from "react"; import {usePreviewState,Action,Loading} from "../../ui";
export default function Surface${i}(){const state=usePreviewState("filled");const[opened,open]=useState(false);return <><Action variant="secondary" style={{position:"fixed",right:16,top:${56 + i * 36}}} onClick={()=>open(true)}>Open surface ${i}</Action>{opened&&<section style={{position:"fixed",left:16,top:340,width:240,background:"var(--color-surface-page)",color:"var(--color-ink)"}}><h2>Surface ${i}</h2>{state==="empty"?<div data-ui="empty-state">No items yet.</div>:state==="loading"?<Loading/>:state==="error"?<div data-ui="notice" data-tone="danger">Could not load items.</div>:<p>One item</p>}</section>}</>}`,
          });
        }
        edits.push({
          path: "apps/web/main.tsx",
          text: imports + original.replace("<App />", "<App />" + mounts),
        });
        const surfaces = Change.parse(
          await supervisor.handle({
            kind: "stage",
            reason: `Add ${surfaceCount} persistent surfaces`,
            edits,
          }),
        );
        const preview = Change.parse(
          await supervisor.handle({
            kind: "preview",
            id: surfaces.id,
            surfaces: [],
          }),
        );
        assert.equal(preview.previews?.surfaces.length, surfaceCount);
        assert.equal(preview.previews?.shots.length, 20 + 4 * surfaceCount);
        t.signal.throwIfAborted();
        await supervisor.handle({ kind: "submit", id: surfaces.id });
        await finish(surfaces);
        if (surfaceCount === 1) {
          const server = Change.parse(
            await supervisor.handle({
              kind: "stage",
              reason: "Unrelated server-only change",
              edits: [
                {
                  path: "apps/server/surface-proof.ts",
                  text: "export const proof = true;",
                },
              ],
            }),
          );
          await supervisor.handle({ kind: "submit", id: server.id });
          await finish(server);
          const reverted = Change.parse(
            await supervisor.handle({ kind: "revert", id: server.id }),
          );
          await finish(reverted);
        }
        const release = join(data, "releases", supervisor.state.active.release);
        await assert.rejects(
          readFile(join(release, "apps/server/surface-proof.ts")),
          /ENOENT/,
        );
        for (let i = 0; i < surfaceCount; i++)
          assert.match(
            await readFile(
              join(release, `apps/web/surfaces/surface-${i}/render.json`),
              "utf8",
            ),
            /Open surface/,
          );
      } finally {
        while (supervisor.busy)
          await new Promise((resolve) => setTimeout(resolve, 50));
        await supervisor.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
