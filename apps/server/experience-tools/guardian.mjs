import process from "node:process";
import { setTimeout, clearTimeout } from "node:timers";
import { spawn, execFileSync } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
let child;
let reason = "exited";
let timer;
let stdout = "";
let stderr = "";
let truncated = false;
const decoders = [new StringDecoder("utf8"), new StringDecoder("utf8")];
let remaining = 0;
function kill() {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
function stop(value) {
  reason = value;
  kill();
}
process.on("disconnect", () => stop("owner_lost"));
process.on("message", (message) => {
  if (message.type === "cancel") return stop("cancelled");
  if (message.type !== "start" || child) return;
  if (!process.connected) return process.exit(1);
  remaining = message.maxBytes;
  child = spawn(message.executable, message.args, {
    cwd: message.cwd,
    env: message.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.pid && process.connected)
    process.send({ type: "started", pid: child.pid }, (error) => {
      if (error) stop("owner_lost");
    });
  timer = setTimeout(() => stop("timeout"), message.timeoutMs);
  function append(index, chunk) {
    const kept = chunk.subarray(0, remaining);
    remaining -= kept.length;
    if (kept.length < chunk.length) truncated = true;
    const text = decoders[index].write(kept);
    if (index === 0) stdout += text;
    else stderr += text;
  }
  child.stdout.on("data", (chunk) => append(0, chunk));
  child.stderr.on("data", (chunk) => append(1, chunk));
  child.on("error", (error) => {
    stderr += error.message;
    reason = "spawn_error";
  });
  child.on("exit", () => kill());
  child.on("close", async (code, signal) => {
    clearTimeout(timer);
    kill();
    if (child.pid) {
      for (;;) {
        const rows = execFileSync("/bin/ps", ["-axo", "pgid=,stat="], {
          encoding: "utf8",
        });
        const alive = rows.split("\n").some((row) => {
          const [group, state] = row.trim().split(/\s+/);
          return Number(group) === child.pid && !state?.startsWith("Z");
        });
        if (!alive) break;
        kill();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    stdout += decoders[0].end();
    stderr += decoders[1].end();
    const result = { code, signal, reason, stdout, stderr, truncated };
    if (process.connected)
      process.send({ type: "result", result }, () => process.exit(0));
    else process.exit(0);
  });
});
