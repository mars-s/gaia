import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { command } from "./process.ts";

test("guardian preserves fast success status and drains stdout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-status-"));
  try {
    for (let i = 0; i < 10; i++)
      assert.equal(
        await command(
          process.execPath,
          ["-e", "process.stdout.write('ok')"],
          dir,
        ),
        "ok",
      );
    await assert.rejects(
      command(process.execPath, ["-e", "process.exit(23)"], dir),
      /failed \(23\)/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("guardian hard deadline kills a hanging command and its descendants", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-deadline-"));
  try {
    await assert.rejects(
      command(
        process.execPath,
        [
          "-e",
          `const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); writeFileSync('pids',JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`,
        ],
        dir,
        1000,
      ),
      /failed/,
    );
    const pids: number[] = JSON.parse(
      await readFile(join(dir, "pids"), "utf8"),
    );
    for (const pid of pids) {
      let status = "";
      try {
        status = execFileSync("/bin/ps", ["-p", String(pid), "-o", "stat="], {
          stdio: ["ignore", "pipe", "ignore"],
        })
          .toString()
          .trim();
      } catch {
        /* Reaped. */
      }
      assert(
        status === "" || status.startsWith("Z"),
        `Process ${pid} remains ${status}`,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SIGKILL of a command owner still kills its hanging process group", async () => {
  const { writeFile } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "gaia-owner-loss-"));
  let pids: number[] = [];
  let owner: ReturnType<typeof spawn> | undefined;
  try {
    const hanging = `const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); writeFileSync('pids',JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`;
    await writeFile(
      join(dir, "owner.mts"),
      `import {command} from ${JSON.stringify(new URL("./process.ts", import.meta.url).href)}; await command(process.execPath, ['-e', ${JSON.stringify(hanging)}], ${JSON.stringify(dir)}, 60000);`,
    );
    owner = spawn(
      process.execPath,
      [
        "--import",
        new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url)
          .pathname,
        join(dir, "owner.mts"),
      ],
      { stdio: "ignore" },
    );
    for (let i = 0; i < 100 && !pids.length; i++) {
      try {
        pids = JSON.parse(await readFile(join(dir, "pids"), "utf8"));
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }
    assert.equal(pids.length, 2);
    const exited = once(owner, "exit");
    owner.kill("SIGKILL");
    await exited;
    const deadline = Date.now() + 3000;
    let alive = true;
    while (alive && Date.now() < deadline) {
      alive = pids.some((pid) => {
        try {
          return !execFileSync("/bin/ps", ["-p", String(pid), "-o", "stat="], {
            stdio: ["ignore", "pipe", "ignore"],
          })
            .toString()
            .trim()
            .startsWith("Z");
        } catch {
          return false;
        }
      });
      if (alive) await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(alive, false, "Hanging command survived owner SIGKILL");
  } finally {
    owner?.kill("SIGKILL");
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* Reaped. */
      }
    }
    await rm(dir, { recursive: true, force: true });
  }
});
