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
function groupAlive(pid: number) {
  const rows = execFileSync("/bin/ps", ["-axo", "pgid=,stat="], {
    encoding: "utf8",
  });
  return rows.split("\n").some((row) => {
    const [group, state] = row.trim().split(/\s+/);
    return Number(group) === pid && !state?.startsWith("Z");
  });
}
async function joinProcessGroup(pid: number) {
  const until = Date.now() + 5000;
  for (;;) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if (!(error instanceof Error && "code" in error)) throw error;
      if (error.code !== "ESRCH" && error.code !== "EPERM") throw error;
    }
    if (!groupAlive(pid)) return;
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
  onStarted?(pid: number): void | Promise<void>;
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
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    let diagnosticBytes = "";
    guardian.stderr?.on("data", (chunk: Buffer) => {
      diagnosticBytes += chunk
        .toString("utf8")
        .slice(0, 1024 - diagnosticBytes.length);
    });
    let result: ProcessResult | undefined;
    let processGroup: number | undefined;
    let failure: Error | undefined;
    let startedWork = Promise.resolve();
    let observationFailed = false;
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
      if (started.success && processGroup === undefined) {
        processGroup = started.data.pid;
        const observe = input.onStarted;
        startedWork = Promise.resolve()
          .then(() => observe?.(started.data.pid))
          .catch(() => {
            observationFailed = true;
            cancel();
          });
      }
      const parsed = z
        .object({ type: z.literal("result"), result: ProcessResult })
        .safeParse(message);
      if (parsed.success) result = parsed.data.result;
    });
    guardian.on("error", (error) => {
      failure = error;
    });
    guardian.on("close", async (code, signal) => {
      await startedWork;
      const errorDetail = diagnosticBytes.match(
        /gaia-guardian-error code=[A-Za-z0-9_]{1,64} syscall=[A-Za-z0-9_]{1,64}/,
      )?.[0];
      const ipcCode =
        failure && "code" in failure
          ? String(failure.code)
              .replace(/[^A-Za-z0-9_]/g, "")
              .slice(0, 64)
          : "none";
      const diagnostic = `Guardian exit code=${code}, signal=${signal}, IPC error=${ipcCode}${errorDetail ? `, ${errorDetail}` : ""}.`;
      clearTimeout(deadline);
      clearTimeout(forced);
      input.signal.removeEventListener("abort", cancel);
      if (result) {
        if (observationFailed)
          reject(
            new NativeProcessFailure(
              "joined",
              "The native process joined, but started-process evidence could not be saved.",
            ),
          );
        else resolve(result);
        return;
      }
      if (!processGroup) {
        reject(
          new NativeProcessFailure(
            "unjoined",
            `${diagnostic} Guardian stopped without process ownership evidence. External outcome is unknown.`,
          ),
        );
        return;
      }
      try {
        await joinProcessGroup(processGroup);
        reject(
          new NativeProcessFailure(
            "joined",
            `${diagnostic} Guardian stopped unexpectedly. Its process group was terminated and joined; the external outcome is unknown.`,
          ),
        );
      } catch {
        reject(
          new NativeProcessFailure(
            "unjoined",
            `${diagnostic} Guardian stopped and native process termination could not be verified. External outcome is unknown.`,
          ),
        );
      }
    });
    guardian.send(
      {
        type: "start",
        ...input,
        signal: undefined,
        onStarted: undefined,
        env: localMachineEnvironment(),
      },
      sendFailed,
    );
    if (input.signal.aborted) cancel();
  });
}
