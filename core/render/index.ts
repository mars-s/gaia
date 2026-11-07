import { mkdir, mkdtemp, writeFile, realpath, rm, cp } from "node:fs/promises";
import { join } from "node:path";
import { command, guarded, cleanEnv, stop } from "../process.ts";
import { Surfaces, type Surface } from "./schema.ts";
import { freePort } from "../sandbox.ts";

export async function renderProfile(stage: string, core: string, dependencies: string, scratch: string, port: number) {
  if (process.platform !== "darwin") throw new Error("Renderer fails closed: macOS sandbox-exec is required");
  const roots = await Promise.all([join(stage, "dist/web"), join(stage, "apps"), join(stage, "core"), join(stage, "packages"), join(core, "core"), join(core, "packages"), dependencies, scratch].map(path => realpath(path)));
  const trusted = await mkdtemp(join(core, ".sandbox-profiles", "render-"));
  const read = [...roots, trusted, "/opt/homebrew", "/System", "/usr/lib", "/usr/share", "/Library/Apple", "/Library/Fonts"];
  const profile = `(version 1)\n(deny default)\n(allow process*)\n(allow sysctl-read)\n(allow iokit-open (iokit-user-client-class "IOSurfaceRootUserClient"))\n(allow mach-lookup)\n(allow mach-register (global-name-regex #"^com[.]github[.]Electron[.]"))\n(allow file-read-metadata)\n(allow file-read-data (literal "/") ${read.map(path => `(subpath ${JSON.stringify(path)})`).join(" ")} ${[stage, core, join(stage, "package.json"), join(stage, "tsconfig.json"), join(core, "package.json"), join(core, "tsconfig.json"), "/dev/urandom", "/dev/random", "/dev/null", "/private/etc/localtime"].map(path => `(literal ${JSON.stringify(path)})`).join(" ")})\n(allow file-write* (subpath ${JSON.stringify(await realpath(scratch))}) (literal "/dev/null"))\n(allow network-bind (local ip "localhost:${port}"))\n(allow network-inbound (local ip "localhost:${port}"))\n(allow network-outbound (remote ip "localhost:${port}"))\n`;
  const policy = join(trusted, "profile.sb"); await writeFile(policy, profile);
  const proof = join(trusted, "proof.mjs");
  await writeFile(proof, `import fs from 'node:fs';import net from 'node:net';import {setTimeout,clearTimeout} from 'node:timers';for(const fn of [()=>fs.readFileSync('/etc/passwd'),()=>fs.writeFileSync(${JSON.stringify(policy)},'bad')]){let denied=false;try{fn()}catch(e){denied=['EACCES','EPERM'].includes(e.code)}if(!denied)throw Error('Outside access allowed')};for(const [host,port] of [['1.1.1.1',443],['127.0.0.1',${port === 65535 ? port - 1 : port + 1}]])await new Promise((resolve,reject)=>{const s=net.createConnection({host,port});const timer=setTimeout(()=>{s.destroy();reject(Error('Denial not proven'))},2000);s.on('error',e=>{clearTimeout(timer);if(['EACCES','EPERM'].includes(e.code))resolve();else reject(e)});s.on('connect',()=>{clearTimeout(timer);s.destroy();reject(Error('Network escaped'))})});`);
  try { await command("/usr/bin/sandbox-exec", ["-f", policy, process.execPath, proof], stage, 10000); }
  catch (error) { await rm(trusted, { recursive: true, force: true }); throw error; }
  return { policy, trusted };
}
export async function renderCandidate({ stage, core, dependencies, surfaces = [], before, baseline = true }: { baseline?: boolean; before?: string; stage: string; core: string; dependencies: string; surfaces?: Surface[] }) {
  await mkdir(join(stage, "dist/web"), { recursive: true }); await mkdir(join(core, ".sandbox-profiles"), { recursive: true });
  const scratch = await mkdtemp(join(stage, "dist/.render-"));
  surfaces = Surfaces.parse(surfaces);
  const webroot = join(scratch, "webroot");
  const results: unknown[] = [];
  let built = false;
  for (const scenario of [...(baseline ? ["empty", "answer", "proposal", "setups", "failed"] : []), ...surfaces.map(surface => surface.name)]) {
    const data = join(scratch, scenario); await mkdir(data);
    const port = await freePort(), origin = `http://127.0.0.1:${port}`;
    const { policy, trusted } = await renderProfile(stage, core, dependencies, scratch, port);
    if (!built) {
      try { await command("/usr/bin/sandbox-exec", ["-f", policy, process.execPath, "--import", join(dependencies, "tsx/dist/loader.mjs"), join(dependencies, "vite/bin/vite.js"), "build", "--config", join(core, "core/render/vite.config.ts"), "--configLoader", "runner", "--outDir", join(webroot, "dist/web")], stage); built = true; }
      catch (error) { await rm(trusted, { recursive: true, force: true }); throw error; }
    }
    const server = guarded("/usr/bin/sandbox-exec", ["-f", policy, process.execPath, "--import", join(dependencies, "tsx/dist/loader.mjs"), join(core, "core/render/fixture.ts"), stage, data, String(port), scenario, webroot], data, { ...cleanEnv(), HOME: data, TMPDIR: data }, 60000);
    let logs = ""; server.stdout?.on("data", chunk => { logs = (logs + chunk).slice(-16000); }); server.stderr?.on("data", chunk => { logs = (logs + chunk).slice(-16000); });
    try {
      const deadline = Date.now() + 20000;
      while (!logs.includes("FIXTURE_READY")) {
        if (server.exitCode !== null || Date.now() > deadline) throw new Error(`Design fixture failed: ${logs.slice(-4000)}`);
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      if (before) await cp(join(before, scenario), join(data, "before"), { recursive: true });
      const job = join(trusted, "job.json"); await writeFile(job, JSON.stringify({ origin, scratch: data, compare: Boolean(before), scenario, surface: surfaces.find(surface => surface.name === scenario), axe: join(dependencies, "axe-core/axe.min.js") }));
      const electron: string = (await import(join(dependencies, "electron/index.js"))).default;
      // Chromium cannot nest Seatbelt. The verified outer profile confines the whole process tree.
      const output = await command("/usr/bin/sandbox-exec", ["-f", policy, electron, "--no-sandbox", join(core, "core/render/browser.mjs"), job], data, 30000);
      results.push(JSON.parse(output));
    } finally { await stop(server); await rm(trusted, { recursive: true, force: true }); }
  }
  await writeFile(join(scratch, "results.json"), JSON.stringify(results, null, 2));
  return { scratch, results };
}
