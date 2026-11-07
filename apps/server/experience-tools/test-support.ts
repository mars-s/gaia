import { NativeProcessFailure, runGuardedProcess } from "./process.ts";

export async function canSignalOwnedChild() {
  try {
    const result = await runGuardedProcess({
      executable: process.execPath,
      args: ["-e", ""],
      cwd: process.cwd(),
      timeoutMs: 2000,
      maxBytes: 1024,
      signal: new AbortController().signal,
    });
    if (result.reason !== "exited" || result.code !== 0)
      throw new Error("Native capability probe did not complete successfully.");
    return true;
  } catch (error) {
    if (
      error instanceof NativeProcessFailure &&
      /EPERM|EACCES/.test(error.message)
    )
      return false;
    throw error;
  }
}
