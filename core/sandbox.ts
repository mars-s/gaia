import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { once } from "node:events";
import { cleanEnv, command, stop } from "./process.ts";
export async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
export async function sandboxProfile(
  stage: string,
  core: string,
  dependencies: string,
) {
  if (process.platform !== "darwin")
    throw new Error(
      "Self-change fails closed. This build requires macOS sandbox-exec.",
    );
  const read = await Promise.all(
    [stage, core, dependencies].map((path) => realpath(path)),
  );
  const literal = (path: string) => JSON.stringify(path);
  const profile = `(version 1)\n(deny default)\n(allow process*)\n(allow sysctl-read)\n(allow mach-lookup)\n(allow file-read-metadata)\n(allow file-read-data (literal "/") ${[...read, "/opt/homebrew", "/System", "/usr/lib", "/usr/share", "/Library/Apple"].map((path) => `(subpath ${literal(path)})`).join(" ")} ${["/dev/urandom", "/dev/random", "/dev/null", "/private/etc/localtime", "/private/etc/hosts", "/private/etc/resolv.conf"].map((path) => `(literal ${literal(path)})`).join(" ")})\n(allow file-write* ${[".scratch", ".probe-data", "dist"].map((name) => `(subpath ${literal(join(read[0] ?? "", name))})`).join(" ")} (literal "/dev/null"))\n(allow network-bind (local ip "localhost:*"))\n(allow network-inbound (local ip "localhost:*"))\n(allow network-outbound (remote ip "localhost:*"))\n`;
  const profiles = join(core, ".sandbox-profiles");
  await mkdir(profiles, { recursive: true, mode: 0o700 });
  const path = join(await mkdtemp(join(profiles, "launch-")), "profile.sb");
  await writeFile(path, profile);
  return path;
}
export async function waitHealth(
  base: string,
  release: string,
  timeout = 15000,
) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try {
      const response = await fetch(`${base}/healthz`, {
        signal: AbortSignal.timeout(1000),
      });
      const value = await response.json();
      if (
        response.ok &&
        value.ok === true &&
        value.release === release &&
        value.schema === 1
      )
        return;
    } catch {
      /* The process may still be opening its databases. */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Health probe deadline exceeded");
}
export async function candidateBoot({
  stage,
  core,
  dependencies,
  release,
}: {
  stage: string;
  core: string;
  dependencies: string;
  release: string;
}) {
  const profile = await sandboxProfile(stage, core, dependencies);
  const data = join(stage, ".probe-data");
  await mkdir(data, { recursive: true });
  const proof = `import {createConnection} from 'node:net';\nimport { readFileSync, writeFileSync } from 'node:fs';\nfor (const fn of [() => readFileSync('/etc/passwd'), () => writeFileSync('/private/tmp/gaia-outside-forbidden', 'bad')]) { let blocked=false; try { fn(); } catch(e) { blocked=e.code==='EPERM'||e.code==='EACCES'; } if(!blocked) throw Error('Outside access not blocked'); }\nawait new Promise((resolve,reject) => { const socket=createConnection({host:'1.1.1.1',port:443}); const timer=setTimeout(()=>{socket.destroy();reject(Error('External network denial not proven'));},2000); socket.once('error',(error)=>{clearTimeout(timer); if(error.code==='EPERM'||error.code==='EACCES') resolve(); else reject(error);}); socket.once('connect',()=>{clearTimeout(timer);socket.destroy();reject(Error('External network allowed'));}); });\nwriteFileSync(${JSON.stringify(join(data, "sandbox-proof"))}, 'outside reads and writes denied; external network denied');`;
  const proofPath = join(stage, ".sandbox-proof.mjs");
  await writeFile(proofPath, proof);
  await command(
    "/usr/bin/sandbox-exec",
    ["-f", profile, process.execPath, proofPath],
    stage,
    10000,
  );
  const port = await freePort();
  const child = spawn(
    "/usr/bin/sandbox-exec",
    [
      "-f",
      profile,
      process.execPath,
      "--import",
      join(dependencies, "tsx/dist/loader.mjs"),
      join(core, "core/child.ts"),
      "--sandbox-probe",
    ],
    {
      cwd: stage,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...cleanEnv(),
        HOME: data,
        TMPDIR: data,
        GAIA_RELEASE: release,
        GAIA_RELEASE_DIR: stage,
        GAIA_GENERATION: data,
        GAIA_DATA_DIR: data,
        GAIA_CREDENTIALS: join(data, "credentials.sqlite"),
        GAIA_HOST: "127.0.0.1",
        GAIA_PORT: String(port),
        GAIA_PROBE_TOKEN: "sandbox",
        GAIA_CONTROL_SOCKET: join(data, "unavailable.sock"),
      },
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output = (output + chunk).slice(-4000);
  });
  child.stderr.on("data", (chunk) => {
    output = (output + chunk).slice(-4000);
  });
  try {
    await waitHealth(`http://127.0.0.1:${port}`, release);
  } catch (error) {
    throw new Error(`${String(error)}\n${output}`, { cause: error });
  } finally {
    await stop(child);
  }
}
