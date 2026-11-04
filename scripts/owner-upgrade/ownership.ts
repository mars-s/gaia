import { open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { command } from "../../core/process.ts";
import { noLinks, readJson, stat, syncDirectory } from "./files.ts";

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH")
      return false;
    throw error;
  }
}

export async function assertStopped(data: string, ownLocks = false) {
  for (const name of ["bootstrap.lock", "supervisor.lock"]) {
    const path = join(data, "control", name);
    await noLinks(path);
    if (!(await stat(path))) continue;
    const pid = z.coerce
      .number()
      .int()
      .positive()
      .parse(await readFile(path, "utf8"));
    if (ownLocks && pid === process.pid) continue;
    if (alive(pid))
      throw new Error(
        `Stop the managed owner before activation (${name}, pid ${pid}).`,
      );
  }
  const childFile = join(data, "control/child.json");
  if (!(await stat(childFile))) return;
  const child = z
    .object({ pid: z.number().int().positive(), marker: z.string() })
    .parse(await readJson(childFile));
  if (!alive(child.pid)) return;
  const args = await command(
    "/bin/ps",
    ["-ww", "-p", String(child.pid), "-o", "command="],
    data,
  );
  if (
    args.includes(`--managed-child=${data}`) ||
    (child.marker.startsWith("--managed-child=") && args.includes(child.marker))
  )
    throw new Error("Stop the managed child before activation.");
}

export async function withOwnerLock<T>(
  data: string,
  stopped: boolean,
  action: () => Promise<T>,
) {
  const locks: { path: string; dev: number; ino: number }[] = [];
  try {
    for (const name of [
      "owner-upgrade.lock",
      ...(stopped ? ["bootstrap.lock", "supervisor.lock"] : []),
    ]) {
      const path = join(data, "control", name);
      await noLinks(path);
      const old = await stat(path);
      if (old) {
        const pid = z.coerce
          .number()
          .int()
          .positive()
          .parse(await readFile(path, "utf8"));
        if (alive(pid))
          throw new Error(
            `Stop the managed owner or other operator (${name}, pid ${pid}).`,
          );
        const current = await stat(path);
        if (!current || old.dev !== current.dev || old.ino !== current.ino)
          throw new Error("Lock changed while acquiring ownership.");
        await rm(path);
      }
      const file = await open(path, "wx", 0o600);
      try {
        const identity = await file.stat();
        locks.push({ path, dev: identity.dev, ino: identity.ino });
        await file.writeFile(String(process.pid));
        await file.sync();
      } finally {
        await file.close();
      }
    }
    if (stopped) await assertStopped(data, true);
    return await action();
  } finally {
    for (const lock of locks.reverse()) {
      const actual = await stat(lock.path);
      if (actual?.dev === lock.dev && actual.ino === lock.ino) {
        await rm(lock.path);
        await syncDirectory(join(data, "control"));
      }
    }
  }
}
