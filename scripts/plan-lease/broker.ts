import { spawn, type SpawnOptions, type ChildProcess } from "node:child_process";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { chmod, mkdtemp, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createAuth } from "../../core/auth.ts";
import { LeaseReply, LeaseRequest, LEASE_MS } from "../../core/plan-lease.ts";
import { withOwnerLock } from "../owner-upgrade/ownership.ts";
import { z } from "zod";

export const Options = z.object({
  ownerData: z.string().min(1), data: z.string().min(1), provider: z.enum(["openai-codex", "anthropic"]),
  port: z.number().int().min(1).max(65535).refine((port) => ![4317, 8096, 8264, 8090].includes(port)),
  hours: z.number().positive().max(12).default(4), host: z.literal("127.0.0.1").default("127.0.0.1"),
}).strict();
type Auth = ReturnType<typeof createAuth>;
type Hooks = { launch?: (command: string, args: string[], options: SpawnOptions) => ChildProcess; configure?: (auth: Auth) => void; now?: () => number; log?: (line: string) => void };
export async function broker(input: z.input<typeof Options>, hooks: Hooks = {}) {
  const options = Options.parse(input);
  const [owner, data] = await Promise.all([realpath(options.ownerData), realpath(options.data)]);
  if (owner === data || owner.startsWith(join(data, sep)) || data.startsWith(join(owner, sep))) throw new Error("Use separate owner and test data directories.");
  await stat(join(owner, "control/manifest.json"));
  await stat(join(owner, "credentials/oauth.sqlite"));
  const now = hooks.now ?? Date.now;
  const log = hooks.log ?? ((line: string) => process.stdout.write(line + "\n"));
  let child: ChildProcess | undefined;
  let finishing = false;
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  const forward = (signal: NodeJS.Signals) => {
    if (child && !finishing) child.kill(signal === "SIGHUP" ? "SIGTERM" : signal);
    else log("Finishing up. Please wait.");
  };
  for (const signal of signals) process.on(signal, forward);
  return withOwnerLock(owner, true, async () => {
    const db = new DatabaseSync(join(owner, "credentials/oauth.sqlite"));
    const auth = createAuth(db);
    let directory: string | undefined;
    const server = createServer({ allowHalfOpen: true });
    const tokens = new Set<string>();
    let granted = 0;
    try {
      hooks.configure?.(auth);
      if (!(await auth.store.read(options.provider))) throw new Error("That plan is not signed in on your Gaia.");
      const deadline = now() + options.hours * 3600_000;
      const key = randomBytes(32).toString("base64url");
      directory = await mkdtemp(join(tmpdir(), "gl-"));
      await chmod(directory, 0o700);
      const socket = join(directory, "s");
      if (Buffer.byteLength(socket) >= 104) throw new Error("Temporary socket path is too long.");
      let open = 0;
      server.on("connection", (client) => {
        if (open >= 8) { client.destroy(); return; }
        open++;
        client.once("close", () => open--);
        client.on("error", () => {});
        const timer = setTimeout(() => client.destroy(), 5000);
        client.once("close", () => clearTimeout(timer));
        let bytes = Buffer.alloc(0);
        let handled = false;
        client.on("data", (chunk: Buffer) => {
          if (handled) return;
          bytes = Buffer.concat([bytes, chunk]);
          if (bytes.length > 4096) { handled = true; client.destroy(); return; }
          if (!bytes.includes(10)) return;
          handled = true;
          void (async () => {
            let reason = "invalid request";
            try {
              const request = LeaseRequest.parse(JSON.parse(bytes.toString("utf8")));
              reason = "wrong key";
              const supplied = Buffer.from(request.key);
              if (supplied.length !== Buffer.byteLength(key) || !timingSafeEqual(supplied, Buffer.from(key))) throw new Error();
              reason = "other plan or expired session";
              if (request.provider !== options.provider || now() >= deadline) throw new Error();
              reason = "plan unavailable";
              await auth.models.getAuth(options.provider, { minOAuthValidityMs: 20 * 60_000 });
              const token = await auth.store.read(options.provider);
              if (token?.type !== "oauth" || now() >= deadline) throw new Error();
              const reply = LeaseReply.parse({ ok: true, access: token.access, expires: Math.min(token.expires, now() + LEASE_MS, deadline) });
              client.end(JSON.stringify(reply) + "\n");
              tokens.add(token.access);
              granted++;
            } catch {
              log(`Refused a lease: ${reason}.`);
              client.end('{"ok":false}\n');
            }
          })();
        });
      });
      server.listen(socket);
      await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
      const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GAIA_")));
      child = (hooks.launch ?? spawn)(process.execPath, ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("core/main.ts"), "--plan-lease"], {
        stdio: "inherit", env: { ...env, GAIA_DATA_DIR: data, GAIA_HOST: "127.0.0.1", GAIA_PORT: String(options.port), GAIA_PLAN_LEASE_SOCKET: socket, GAIA_PLAN_LEASE_KEY: key, GAIA_PLAN_LEASE_PROVIDER: options.provider },
      });
      const timer = setTimeout(() => log("Lease time is up"), Math.max(0, deadline - now()));
      log(`Plan lease ${options.provider} until ${new Date(deadline).toISOString()} at http://127.0.0.1:${options.port}`);
      try {
        return await new Promise<number>((resolve, reject) => { child!.once("error", reject); child!.once("exit", (code) => resolve(code ?? 1)); });
      } finally {
        clearTimeout(timer);
        finishing = true;
      }
    } finally {
      finishing = true;
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      if (directory) await rm(directory, { recursive: true, force: true });
      await auth.close(); db.close();
      const found: string[] = [];
      async function scan(path: string) {
        for (const entry of await readdir(path, { withFileTypes: true })) {
          if (entry.name === "dependencies" || entry.isSymbolicLink()) continue;
          const file = join(path, entry.name);
          if (entry.isDirectory()) await scan(file);
          else if (entry.isFile()) {
            const bytes = await readFile(file);
            if ([...tokens].some((token) => bytes.includes(token))) found.push(file);
          }
        }
      }
      await scan(data);
      log(`Lease tokens found in test data: ${found.length ? found.join(", ") : "none"}`);
      log(`Leases granted: ${granted}`);
    }
  }).finally(() => {
    for (const signal of signals) process.off(signal, forward);
  });
}
