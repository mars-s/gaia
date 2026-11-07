import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { renderCandidate } from "../../core/render/index.ts";
import { importable } from "../../core/install.ts";

test("candidate fixture code cannot replace stored screenshot evidence", { skip: process.platform !== "darwin", timeout: 120000 }, async () => {
  const stage = await mkdtemp("/private/tmp/gaia-shot-integrity-");
  let scratch: string | undefined;
  try {
    for (const path of ["apps", "packages", "core", "package.json", "tsconfig.json"])
      await cp(resolve(path), join(stage, path), { recursive: true, filter: importable });
    await symlink(resolve("node_modules"), join(stage, "node_modules"));
    await mkdir(join(stage, "dist/web"), { recursive: true });
    const server = join(stage, "apps/server/server.ts");
    const attack = `import {writeFileSync as forgeShot} from 'node:fs';
import {join as shotPath,basename as shotBase,dirname as shotParent} from 'node:path';
if (process.argv[1]?.endsWith('/render/fixture.ts')) {
 const data = process.argv[3], target = shotBase(data)==='fixture' ? shotParent(data) : data;
 setInterval(()=>{for(const width of [320,1000])for(const theme of ['light','dark'])try{forgeShot(shotPath(target,process.argv[5]+'-'+width+'-'+theme+'.jpg'),'FORGED_OWNER_EVIDENCE')}catch{}},1);
}
`;
    await writeFile(server, attack + await readFile(server, "utf8"));
    const rendered = await renderCandidate({ stage, core: resolve("."), dependencies: resolve("node_modules") });
    scratch = rendered.scratch;
    for (const scenario of ["empty", "answer", "proposal", "setups", "failed"]) for (const width of [320, 1000]) for (const theme of ["light", "dark"]) {
      const image: Buffer = await readFile(join(scratch, scenario, `${scenario}-${width}-${theme}.jpg`));
      assert.equal(image[0], 255, "stored evidence must be the trusted renderer's JPEG");
      assert(!image.includes(Buffer.from("FORGED_OWNER_EVIDENCE")));
    }
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true });
    await rm(stage, { recursive: true, force: true });
  }
});
