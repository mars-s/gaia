import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { once } from "node:events";
export async function command(
  file: string,
  args: string[],
  cwd: string,
  timeout = 120000,
  raw = false,
) {
  await mkdir(join(cwd, ".scratch"), { recursive: true });
  const child = spawn(file, args, {
    cwd,
    env: { ...cleanEnv(), HOME: cwd, TMPDIR: join(cwd, ".scratch") },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  let diagnostics = "";
  let overflow = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    output += chunk;
    if (output.length > 32000000) {
      overflow = true;
      kill(child);
    }
  });
  child.stderr.on("data", (chunk: string) => {
    diagnostics = (diagnostics + chunk).slice(-16000);
  });
  const timer = setTimeout(() => kill(child), timeout);
  try {
    const [code] = await once(child, "exit");
    if (overflow)
      throw new Error("Command output exceeded the bounded capture limit.");
    if (code !== 0)
      throw new Error(
        `${file} ${args.join(" ")} failed (${code})\n${output.slice(-16000)}\n${diagnostics}`,
      );
    return raw ? output : output.trim();
  } finally {
    clearTimeout(timer);
    kill(child);
  }
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
