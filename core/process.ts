import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
export async function command(
  file: string,
  args: string[],
  cwd: string,
  timeout = 120000,
  raw = false,
) {
  await mkdir(join(cwd, ".scratch"), { recursive: true });
  const child = guarded(
    file,
    args,
    cwd,
    {
      ...cleanEnv(),
      HOME: cwd,
      TMPDIR: join(cwd, ".scratch"),
    },
    timeout,
  );
  let output = "";
  let diagnostics = "";
  let overflow = false;
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    output += chunk;
    if (output.length > 32000000) {
      overflow = true;
      kill(child);
    }
  });
  child.stderr?.on("data", (chunk: string) => {
    diagnostics = (diagnostics + chunk).slice(-16000);
  });
  try {
    const [code] = await once(child, "close");
    if (overflow)
      throw new Error("Command output exceeded the bounded capture limit.");
    if (code !== 0)
      throw new Error(
        `${file} ${args.join(" ")} failed (${code})\n${output.slice(-16000)}\n${diagnostics}`,
      );
    return raw ? output : output.trim();
  } finally {
    kill(child);
  }
}
const guardians = new WeakSet<ChildProcess>();
export function guarded(
  file: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeout: number,
) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./guardian.ts", import.meta.url))],
    {
      cwd,
      env: cleanEnv(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  guardians.add(child);
  child.send({ file, args, cwd, env, timeout });
  return child;
}
export function cleanEnv(): NodeJS.ProcessEnv {
  return {
    PATH: "/opt/homebrew/bin:/usr/bin:/bin",
    LANG: "en_AU.UTF-8",
    NODE_NO_WARNINGS: "1",
    TSX_DISABLE_CACHE: "1",
  };
}
export function kill(child: ChildProcess, signal: NodeJS.Signals = "SIGKILL") {
  if (guardians.has(child)) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
    return;
  }
  if (child.pid) {
    try {
      process.kill(-child.pid, signal);
    } catch {
      /* Already exited. */
    }
  }
}
export async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) {
    kill(child);
    return;
  }
  const exited = once(child, "exit");
  kill(child, "SIGTERM");
  const timer = setTimeout(() => kill(child), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
    kill(child);
  }
}
