import { spawn, type ChildProcess } from "node:child_process";
import { z } from "zod";

const Launch = z.object({
  file: z.string(),
  args: z.array(z.string()),
  cwd: z.string(),
  env: z.record(z.string(), z.string()),
  timeout: z.number().positive().finite(),
});
let child: ChildProcess | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
function finish(code: number) {
  if (timer) clearTimeout(timer);
  if (child?.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* The command group has already exited. */
    }
  }
  process.exit(code);
}
process.on("disconnect", () => finish(1));
process.on("SIGTERM", () => finish(1));
process.on("SIGINT", () => finish(1));
process.once("message", (message) => {
  const launch = Launch.parse(message);
  if (!process.connected) return finish(1);
  timer = setTimeout(() => finish(1), launch.timeout);
  child = spawn(launch.file, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    detached: true,
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.once("error", () => finish(1));
  child.once("exit", (code) => finish(code ?? 1));
});
