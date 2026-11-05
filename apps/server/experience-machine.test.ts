import { canSignalOwnedChild } from "./experience-tools/test-support.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import {
  runGuardedProcess,
  machineEnvironment,
  localMachineEnvironment,
  NativeProcessFailure,
} from "./experience-tools/process.ts";
import { DesktopLease } from "./experience-tools/lease.ts";

const run = (
  args: string[],
  signal = new AbortController().signal,
  timeoutMs = 3000,
  maxBytes = 1000,
) =>
  runGuardedProcess({
    executable: process.execPath,
    args,
    cwd: tmpdir(),
    signal,
    timeoutMs,
    maxBytes,
  });
async function waitForFile(path: string) {
  for (let i = 0; i < 200; i++) {
    try {
      return await readFile(path, "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error("Fixture did not start.");
}
function alive(pid: number) {
  try {
    return !execFileSync("/bin/ps", ["-o", "stat=", "-p", String(pid)], {
      encoding: "utf8",
    })
      .trim()
      .startsWith("Z");
  } catch {
    return false;
  }
}
test("failed started-process evidence still cancels and joins the owned process", async (t) => {
  if (!(await canSignalOwnedChild()))
    return t.skip(
      "Protected candidate sandbox denies signalling owned processes.",
    );
  let pid: number | undefined;
  await assert.rejects(
    runGuardedProcess({
      executable: process.execPath,
      args: ["-e", "setInterval(() => {}, 100)"],
      cwd: tmpdir(),
      signal: new AbortController().signal,
      timeoutMs: 3000,
      maxBytes: 1000,
      onStarted(startedPid) {
        pid = startedPid;
        throw new Error("Owned evidence failure");
      },
    }),
    (error: unknown) =>
      error instanceof NativeProcessFailure && error.lifetime === "joined",
  );
  assert(pid);
  assert.equal(alive(pid), false);
});
test("guarded argv preserves Unicode, exit status, environment and output bounds", async (t) => {
  if (!(await canSignalOwnedChild()))
    return t.skip(
      "Protected candidate sandbox denies signalling owned processes.",
    );
  const success = await run([
    "-e",
    "process.stdout.write('🦘你好');process.stderr.write('diagnostic')",
  ]);
  assert.equal(success.stdout, "🦘你好");
  assert.equal(success.stderr, "diagnostic");
  assert.equal(success.code, 0);
  const failure = await run(["-e", "process.exit(7)"]);
  assert.equal(failure.code, 7);
  const bounded = await run(
    ["-e", "process.stdout.write('x'.repeat(20000))"],
    undefined,
    3000,
    50,
  );
  assert.equal(bounded.stdout.length, 50);
  assert.equal(bounded.truncated, true);
  assert.deepEqual(
    machineEnvironment({
      HOME: "/tmp",
      PATH: "/bin",
      OAUTH_TOKEN: "synthetic",
      GAIA_CONTROL: "synthetic",
      NODE_OPTIONS: "--inspect",
      OPENAI_API_KEY: "synthetic",
    }),
    { HOME: "/tmp", PATH: "/bin" },
  );
  const machine = localMachineEnvironment({
    HOME: "/synthetic/gaia/service-home",
    PATH: "/bin",
    GAIA_CREDENTIALS: "/synthetic/private",
    OPENAI_API_KEY: "synthetic",
  });
  assert.equal(machine.HOME, userInfo().homedir);
  assert.equal(machine.GAIA_CREDENTIALS, undefined);
  assert.equal(machine.OPENAI_API_KEY, undefined);
});
test(
  "timeout and cancellation kill and join descendants",
  { timeout: 15000 },
  async (t) => {
    if (!(await canSignalOwnedChild()))
      return t.skip(
        "Protected candidate sandbox denies signalling owned processes.",
      );
    const dir = await mkdtemp(join(tmpdir(), "gaia-tools-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    for (const mode of ["timeout", "cancel"]) {
      const path = join(dir, mode);
      const script = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(path)},String(c.pid));setInterval(()=>{},1000)`;
      const controller = new AbortController();
      const pending = run(
        ["-e", script],
        controller.signal,
        mode === "timeout" ? 2000 : 10000,
      );
      const pid = Number(await waitForFile(path));
      if (mode === "cancel") controller.abort();
      const result = await pending;
      assert.equal(result.reason, mode === "timeout" ? "timeout" : "cancelled");
      assert.equal(alive(pid), false, "descendant must be dead before receipt");
    }
  },
);
test(
  "independent guardian cleans descendants after owner SIGKILL",
  { timeout: 15000 },
  async (t) => {
    if (!(await canSignalOwnedChild()))
      return t.skip(
        "Protected candidate sandbox denies signalling owned processes.",
      );
    const dir = await mkdtemp(join(tmpdir(), "gaia-owner-loss-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pidFile = join(dir, "pids");
    const ownerFile = join(dir, "owner.mjs");
    const guardianUrl = new URL(
      "./experience-tools/guardian.mjs",
      import.meta.url,
    ).href;
    const target = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000)`;
    await writeFile(
      ownerFile,
      `import {fork} from 'node:child_process';import {fileURLToPath} from 'node:url';const c=fork(fileURLToPath(${JSON.stringify(guardianUrl)}),[],{detached:true,stdio:['ignore','ignore','ignore','ipc']});c.send({type:'start',executable:process.execPath,args:['-e',${JSON.stringify(target)}],cwd:${JSON.stringify(dir)},env:{PATH:'/bin'},timeoutMs:10000,maxBytes:1000});`,
    );
    const owner = spawn(process.execPath, [ownerFile], { stdio: "ignore" });
    t.after(() => {
      if (owner.exitCode === null && owner.signalCode === null)
        owner.kill("SIGKILL");
    });
    const pids: number[] = JSON.parse(await waitForFile(pidFile));
    owner.kill("SIGKILL");
    for (let i = 0; i < 200 && pids.some(alive); i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert(pids.every((pid) => !alive(pid)));
  },
);
test("desktop lease cancellation cannot release an earlier owner or deliver late input", async () => {
  const lease = new DesktopLease();
  const events: string[] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = lease.use(new AbortController().signal, async () => {
    events.push("first");
    await held;
    events.push("released");
  });
  const controller = new AbortController();
  const second = lease.use(controller.signal, async () => {
    events.push("late click");
  });
  const third = lease.use(new AbortController().signal, async () => {
    events.push("third");
  });
  controller.abort(new Error("cancelled queue"));
  await assert.rejects(second, /cancelled queue/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["first"]);
  release();
  await Promise.all([first, third]);
  assert.deepEqual(events, ["first", "released", "third"]);
});
test("an unjoined desktop owner prevents queued and future input", async () => {
  const lease = new DesktopLease();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = lease.use(new AbortController().signal, async () => {
    await gate;
    throw new NativeProcessFailure("unjoined", "Owned input did not join.");
  });
  let delivered = false;
  const second = lease.use(new AbortController().signal, async () => {
    delivered = true;
  });
  const checked = Promise.all([
    assert.rejects(first, /Owned input did not join/),
    assert.rejects(second, /Owned input did not join/),
  ]);
  release();
  await checked;
  await assert.rejects(
    lease.use(new AbortController().signal, async () => {
      delivered = true;
    }),
    /Owned input did not join/,
  );
  assert.equal(delivered, false);
});

test("lost guardian stays uncertain after the parent joins its process group", async (t) => {
  if (!(await canSignalOwnedChild()))
    return t.skip("Owned process signalling is unavailable.");
  await assert.rejects(
    run([
      "-e",
      "process.kill(process.ppid,'SIGKILL');setInterval(()=>{},1000)",
    ]),
    (error: unknown) => {
      assert(error instanceof NativeProcessFailure);
      assert.equal(error.lifetime, "joined");
      assert.match(error.message, /signal=SIGKILL/);
      assert.match(error.message, /external outcome is unknown/);
      return true;
    },
  );
});
