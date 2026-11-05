import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ProcessResult } from "./experience-tools/process.ts";
import { canSignalOwnedChild } from "./experience-tools/test-support.ts";

test(
  "guardian returns known receipts when repeated kill gets EPERM for an empty group",
  { timeout: 15000 },
  async (t) => {
    if (!(await canSignalOwnedChild()))
      return t.skip("Owned process signalling is unavailable.");
    const dir = await mkdtemp(join(tmpdir(), "gaia-empty-group-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const preload = join(dir, "empty-group.mjs");
    const marker = join(dir, "observed");
    // Reproduce the macOS post-exit EPERM after checking the real process table.
    await writeFile(
      preload,
      `import process from 'node:process';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const kill=process.kill.bind(process);
let deniedLive=false;
process.kill=(pid,signal)=>{
  if(pid<0){
    const rows=execFileSync('/bin/ps',['-axo','pgid=,stat='],{encoding:'utf8'});
    const alive=rows.split('\\n').some(row=>{const [group,state]=row.trim().split(/\\s+/);return Number(group)===-pid&&!state?.startsWith('Z')});
    if(alive&&!deniedLive){deniedLive=true;throw Object.assign(new Error('synthetic exit transition'),{code:'EPERM',syscall:'kill'})}
    if(!alive){writeFileSync(${JSON.stringify(marker)},'EPERM after verified empty group');throw Object.assign(new Error('synthetic kill EPERM'),{code:'EPERM',syscall:'kill'})}
  }
  return kill(pid,signal);
};`,
    );
    for (const reason of ["exited", "timeout", "cancelled"]) {
      await rm(marker, { force: true });
      const guardian = fork(
        fileURLToPath(
          new URL("./experience-tools/guardian.mjs", import.meta.url),
        ),
        [],
        {
          execArgv: ["--import", pathToFileURL(preload).href],
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        },
      );
      t.after(() => {
        if (guardian.exitCode === null && guardian.signalCode === null)
          guardian.kill("SIGKILL");
      });
      let receipt: unknown;
      let diagnostics = "";
      guardian.stderr?.on("data", (chunk) => {
        diagnostics += String(chunk).slice(0, 2000);
      });
      guardian.on("message", (message) => {
        if (typeof message !== "object" || !message) return;
        if (
          "type" in message &&
          message.type === "started" &&
          reason === "cancelled"
        )
          guardian.send({ type: "cancel" });
        if ("result" in message) receipt = message.result;
      });
      const closed = once(guardian, "close");
      guardian.send({
        type: "start",
        executable: process.execPath,
        args: [
          "-e",
          reason === "exited"
            ? "process.stdout.write('done')"
            : "setInterval(()=>{},1000)",
        ],
        cwd: dir,
        env: { PATH: "/bin" },
        timeoutMs: reason === "timeout" ? 100 : 3000,
        maxBytes: 1000,
      });
      const [code] = await closed;
      assert.equal(code, 0, diagnostics);
      assert.equal(ProcessResult.parse(receipt).reason, reason);
      assert.match(
        await readFile(marker, "utf8"),
        /EPERM after verified empty group/,
      );
    }
  },
);

test(
  "guardian refuses a receipt when EPERM leaves a live group",
  { timeout: 10000 },
  async (t) => {
    if (!(await canSignalOwnedChild()))
      return t.skip("Owned process signalling is unavailable.");
    const dir = await mkdtemp(join(tmpdir(), "gaia-denied-group-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const preload = join(dir, "denied.mjs");
    await writeFile(
      preload,
      `const kill=process.kill.bind(process);process.kill=(pid,signal)=>{if(pid<0)throw Object.assign(new Error('synthetic denial'),{code:'EPERM',syscall:'kill'});return kill(pid,signal)}`,
    );
    const guardian = fork(
      fileURLToPath(
        new URL("./experience-tools/guardian.mjs", import.meta.url),
      ),
      [],
      {
        execArgv: ["--import", pathToFileURL(preload).href],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    let group: number | undefined;
    let receipt = false;
    let diagnostics = "";
    t.after(() => {
      if (group) {
        try {
          process.kill(-group, "SIGKILL");
        } catch {
          /* Already exited. */
        }
      }
      if (guardian.exitCode === null && guardian.signalCode === null)
        guardian.kill("SIGKILL");
    });
    guardian.stderr?.on("data", (chunk) => {
      diagnostics += String(chunk).slice(0, 2000 - diagnostics.length);
    });
    guardian.on("message", (message) => {
      if (typeof message !== "object" || !message) return;
      if ("result" in message) receipt = true;
      if ("pid" in message && typeof message.pid === "number") {
        group = message.pid;
        guardian.send({ type: "cancel" });
      }
    });
    const closed = once(guardian, "close");
    guardian.send({
      type: "start",
      executable: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"],
      cwd: dir,
      env: { PATH: "/bin" },
      timeoutMs: 3000,
      maxBytes: 1000,
    });
    const [code] = await closed;
    assert.equal(code, 1);
    assert.equal(receipt, false);
    assert.match(diagnostics, /gaia-guardian-error code=EPERM syscall=kill/);
    assert(group);
    assert.equal(
      process.kill(group, 0),
      true,
      "the denied group is still live",
    );
  },
);
