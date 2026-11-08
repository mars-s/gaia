import { mkdir, readFile, rm, cp, realpath, open } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { z } from "zod";
import { installCore, importBaseline, verifyProtected } from "./install.ts";
import { Supervisor } from "./supervisor.ts";
import { planLease } from "./plan-lease.ts";
import { atomic } from "./state.ts";
process.umask(0o077);
const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = resolve(process.env.GAIA_DATA_DIR ?? "./data");
const host = process.env.GAIA_HOST ?? "127.0.0.1";
const port = Number(process.env.GAIA_PORT ?? 4319);
if (
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535 ||
  [8096, 8264, 8090].includes(port)
)
  throw new Error("Invalid GAIA_PORT. Avoid 8096, 8264 and 8090.");
if (host !== "127.0.0.1" && host !== "localhost")
  throw new Error(
    "This local managed slice requires a loopback GAIA_HOST. Remote pairing is not implemented.",
  );
for (const dir of [
  "control",
  "credentials",
  "dependencies",
  "staging",
  "releases",
  "generations",
  "snapshots",
  "home",
])
  await mkdir(join(data, dir), { recursive: true, mode: 0o700 });
const dependencies = join(data, "dependencies/node_modules");
async function lockFile(path: string) {
  try {
    const file = await open(path, "wx");
    await file.writeFile(String(process.pid));
    await file.close();
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
    const pid = z.coerce
      .number()
      .int()
      .positive()
      .parse(await readFile(path, "utf8"));
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    if (alive)
      throw new Error("Another managed process owns this data directory.", {
        cause: error,
      });
    await rm(path);
    const file = await open(path, "wx");
    await file.writeFile(String(process.pid));
    await file.close();
  }
}
if (!process.argv.includes("--installed")) {
  const bootstrapLock = join(data, "control/bootstrap.lock");
  await lockFile(bootstrapLock);

  let installed: string;
  try {
    installed = z
      .string()
      .parse(
        JSON.parse(await readFile(join(data, "control/core.json"), "utf8")),
      );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    await cp(join(source, "node_modules"), dependencies, {
      recursive: true,
      verbatimSymlinks: true,
    });
    installed = join(data, "protected", randomUUID());
    await installCore(source, installed, dependencies);
    await atomic(join(data, "control/core.json"), installed);
  }
  const child = spawn(
    process.execPath,
    [
      "--import",
      join(dependencies, "tsx/dist/loader.mjs"),
      join(installed, "core/main.ts"),
      "--installed",
      ...(process.argv.includes("--test-provider") ? ["--test-provider"] : []),
      ...(process.argv.includes("--plan-lease") ? ["--plan-lease"] : []),
    ],
    {
      stdio: "inherit",
      env: { ...process.env, GAIA_DATA_DIR: data, GAIA_IMPORT_SOURCE: source },
    },
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => {
    void rm(bootstrapLock, { force: true }).then(() => process.exit(code ?? 1));
  });
} else {
  await verifyProtected(
    source,
    z
      .record(z.string(), z.string())
      .parse(
        JSON.parse(await readFile(join(source, "integrity.json"), "utf8")),
      ),
  );
  if (process.argv.includes("--plan-lease") && process.argv.includes("--test-provider"))
    throw new Error("Plan leases cannot use the test provider.");
  const lease = process.argv.includes("--plan-lease") ? planLease(process.env) : undefined;
  const lock = join(data, "control/supervisor.lock");
  await lockFile(lock);
  try {
    try {
      await readFile(join(data, "control/manifest.json"));
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
      await importBaseline(
        await realpath(process.env.GAIA_IMPORT_SOURCE ?? source),
        data,
        source,
        dependencies,
      );
    }
    const supervisor = new Supervisor({
      data,
      core: source,
      dependencies,
      host,
      port,
      testProvider: process.argv.includes("--test-provider"),
      planLease: lease,
    });
    await supervisor.open();
    process.stdout.write(
      `Gaia managed http://${host}:${port}\nData ${data}\nMode ${supervisor.state.kind}\n`,
    );
    let closing = false;
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, () => {
        if (closing) return;
        closing = true;
        void supervisor.close().then(async () => {
          await rm(lock);
          process.exit(0);
        });
      });
  } catch (error) {
    await rm(lock, { force: true });
    throw error;
  }
}
