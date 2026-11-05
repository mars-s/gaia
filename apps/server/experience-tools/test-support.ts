import { spawn } from "node:child_process";
import { once } from "node:events";

export async function canSignalOwnedChild() {
  const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},50)"], {
    stdio: "ignore",
  });
  const exited = once(child, "exit");
  let allowed = true;
  try {
    if (child.pid) process.kill(child.pid, 0);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EPERM"
    )
      throw error;
    allowed = false;
  }
  await exited;
  return allowed;
}
