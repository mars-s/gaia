import { execFileSync, fork } from "node:child_process";
import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const ProcessResult = z.object({
  code: z.number().nullable(),
  signal: z.string().nullable(),
  reason: z.enum([
    "exited",
    "timeout",
    "cancelled",
    "owner_lost",
    "spawn_error",
  ]),
  stdout: z.string(),
  stderr: z.string(),
  truncated: z.boolean(),
});
export type ProcessResult = z.infer<typeof ProcessResult>;
export class NativeProcessFailure extends Error {
  constructor(
    readonly lifetime: "joined" | "unjoined",
    message: string,
  ) {
    super(message);
  }
}
export function machineEnvironment(source: NodeJS.ProcessEnv = process.env) {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "SHELL",
  ]) {
    if (source[key]) env[key] = source[key];
  }
  return env;
}
export function localMachineEnvironment(
  source: NodeJS.ProcessEnv = process.env,
) {
  const owner = userInfo();
  return machineEnvironment({
    ...source,
    HOME: owner.homedir,
    USER: owner.username,
    LOGNAME: owner.username,
  });
}
async function joinProcessGroup(pid: number) {
  const until = Date.now() + 5000;
  for (;;) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ESRCH"
      ))
        throw error;
    }
    const rows = execFileSync("/bin/ps", ["-axo", "pgid=,stat="], {
      encoding: "utf8",
    });
    const alive = rows.split("\n").some((row) => {
      const [group, state] = row.trim().split(/\s+/);
      return Number(group) === pid && !state?.startsWith("Z");
    });
    if (!alive) return;
    if (Date.now() >= until)
      throw new Error("Native process group did not stop.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
export function runGuardedProcess(input: {
  executable: string;
  args: string[];
  cwd: string;
  signal: AbortSignal;
  timeoutMs: number;
  maxBytes: number;
}): Promise<ProcessResult> {
  input.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const guardian = fork(
      fileURLToPath(new URL("./guardian.mjs", import.meta.url)),
      [],
      {
        detached: true,
        execArgv: [],
        env: localMachineEnvironment(),
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    let result: ProcessResult | undefined;
    let processGroup: number | undefined;
    let failure: Error | undefined;
    let forced: ReturnType<typeof setTimeout> | undefined;
    const deadline = setTimeout(
      () => guardian.kill("SIGKILL"),
      input.timeoutMs + 5000,
    );
    const sendFailed = (error: Error | null) => {
      if (!error) return;
      failure = error;
      guardian.kill("SIGKILL");
    };
    const cancel = () => {
      if (guardian.connected) guardian.send({ type: "cancel" }, sendFailed);
      forced ??= setTimeout(() => guardian.kill("SIGKILL"), 2000);
    };
    input.signal.addEventListener("abort", cancel, { once: true });
    guardian.on("message", (message) => {
      const started = z
        .object({
          type: z.literal("started"),
          pid: z.number().int().positive(),
        })
        .safeParse(message);
      if (started.success) processGroup = started.data.pid;
      const parsed = z
        .object({ type: z.literal("result"), result: ProcessResult })
        .safeParse(message);
      if (parsed.success) result = parsed.data.result;
    });
    guardian.on("error", (error) => {
      failure = error;
    });
    guardian.on("close", async () => {
      clearTimeout(deadline);
      clearTimeout(forced);
      input.signal.removeEventListener("abort", cancel);
      if (result) return resolve(result);
      if (!processGroup) {
        reject(
          new NativeProcessFailure(
            "unjoined",
            failure?.message ??
              "Guardian stopped without process ownership evidence. External outcome is unknown.",
          ),
        );
        return;
      }
      try {
        await joinProcessGroup(processGroup);
        reject(
          new NativeProcessFailure(
            "joined",
            "Guardian stopped unexpectedly. Its process group was terminated and joined; the external outcome is unknown.",
          ),
        );
      } catch {
        reject(
          new NativeProcessFailure(
            "unjoined",
            "Guardian stopped and native process termination could not be verified. External outcome is unknown.",
          ),
        );
      }
    });
    guardian.send(
      {
        type: "start",
        ...input,
        signal: undefined,
        env: localMachineEnvironment(),
      },
      sendFailed,
    );
    if (input.signal.aborted) cancel();
  });
}
