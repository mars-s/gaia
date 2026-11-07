import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile, cp, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { z } from "zod";
import {
  atomic,
  readState,
  Change,
  Command,
  type State,
  type Pair,
  type Edit,
  patchText,
} from "./state.ts";
import { command, cleanEnv, stop } from "./process.ts";
import { safeFile, verifyProtected } from "./install.ts";
import { designPack } from "./design/pack.ts";
import { recipe } from "./recipe.ts";
import { waitHealth } from "./sandbox.ts";
import { compatible } from "./schema.ts";
import { probes } from "./probes.ts";
import { quiesce } from "./quiescence.ts";
export interface Options {
  data: string;
  core: string;
  dependencies: string;
  host: string;
  port: number;
  testProvider: boolean;
  probeTimeout?: number;
  bootTimeout?: number;
  quiesceTimeout?: number;
}
export class Supervisor {
  state!: State;
  history: Change[] = [];
  child: ChildProcess | undefined;
  busy = false;
  closing = false;
  private controlServer = createServer();
  private token = randomUUID();
  private protected: Record<string, string> = {};
  private watching = false;
  private watcher: ReturnType<typeof setInterval> | undefined;
  constructor(readonly options: Options) {}
  get base() {
    return `http://${this.options.host}:${this.options.port}`;
  }
  get socket() {
    return join(this.options.data, "control/supervisor.sock");
  }
  private async persist(state: State) {
    await atomic(join(this.options.data, "control/manifest.json"), state);
    this.state = state;
  }
  private async saveHistory() {
    await atomic(join(this.options.data, "control/history.json"), this.history);
  }
  async open() {
    const { data } = this.options;
    this.state = await readState(data);
    this.history = z
      .array(Change)
      .parse(
        JSON.parse(await readFile(join(data, "control/history.json"), "utf8")),
      );
    this.protected = z
      .record(z.string(), z.string())
      .parse(
        JSON.parse(
          await readFile(join(data, "control/protected.json"), "utf8"),
        ),
      );
    const childRecord = join(data, "control/child.json");
    try {
      const saved = z
        .object({ pid: z.number(), marker: z.string() })
        .parse(JSON.parse(await readFile(childRecord, "utf8")));
      try {
        const args = await command(
          "/bin/ps",
          ["-ww", "-p", String(saved.pid), "-o", "command="],
          data,
        );
        if (args.includes(saved.marker)) process.kill(-saved.pid, "SIGKILL");
      } catch {
        /* The previous managed child has already exited. */
      }
      await rm(childRecord, { force: true });
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    await this.recover();
    await rm(this.socket, { force: true });
    this.controlServer.on("request", async (req, res) => {
      try {
        req.setEncoding("utf8");
        let text = "";
        for await (const chunk of req) {
          text += chunk;
          if (Buffer.byteLength(text) > 1000000)
            throw new Error("Change too large");
        }
        const result = await this.handle(Command.parse(JSON.parse(text)));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
    });
    await new Promise<void>((resolve) =>
      this.controlServer.listen(this.socket, resolve),
    );
    try {
      await this.bootRecovering();
    } catch (error) {
      await this.close();
      throw error;
    }
    this.watcher = setInterval(() => {
      void this.watch().catch((error) =>
        process.stderr.write(`Watchdog ${String(error)}\n`),
      );
    }, 250);
  }
  private async recover() {
    const state = this.state;
    if (state.kind === "switching" || state.kind === "probing") {
      const change = this.history.find((entry) => entry.id === state.change);
      if (change) {
        change.outcome = "interrupted";
        change.detail =
          "Supervisor restarted during promotion; restored previous code and data.";
      }
      await this.persist({
        kind: "stable",
        active: state.previous,
        good: state.good,
        failures: state.failures + 1,
      });
    } else if (state.kind === "checking") {
      const change = this.history.find((entry) => entry.id === state.change);
      if (change) {
        change.outcome = "interrupted";
        change.detail = "Supervisor restarted during checks.";
      }
      await this.persist({
        kind: "stable",
        active: state.active,
        good: state.good,
        failures: state.failures + 1,
      });
    }
    for (const entry of this.history)
      if (entry.outcome === "queued") {
        entry.outcome = "interrupted";
        entry.detail = "Queued deployment interrupted by restart.";
      }
    if (this.state.failures >= 3 && this.state.kind !== "safe")
      await this.pinSafe(
        "Three consecutive failures, including interrupted promotions.",
      );
    const receipt = this.state.receipt;
    if (receipt) {
      const entry = this.history.find((change) => change.id === receipt.id);
      if (entry) {
        entry.outcome = receipt.outcome;
        entry.detail = receipt.detail;
        entry.commit = receipt.commit;
      }
    }
    await this.saveHistory();
  }
  private async pinSafe(reason: string) {
    await compatible(
      join(this.options.data, "generations", this.state.good.generation),
      join(this.options.data, "generations", this.state.active.generation),
    );
    await this.persist({
      kind: "safe",
      receipt: this.state.receipt,
      active: { ...this.state.active, release: this.state.good.release },
      good: this.state.good,
      failures: this.state.failures,
      reason,
    });
  }
  private async boot() {
    const { data, core, dependencies, host, port, testProvider } = this.options;
    const pair = this.state.active;
    const child = spawn(
      process.execPath,
      [
        "--import",
        join(dependencies, "tsx/dist/loader.mjs"),
        join(core, "core/child.ts"),
        `--managed-child=${data}`,
        ...(testProvider ? ["--test-provider"] : []),
      ],
      {
        cwd: join(data, "releases", pair.release),
        detached: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: {
          ...cleanEnv(),
          HOME: join(data, "home"),
          GAIA_RELEASE: pair.release,
          GAIA_RELEASE_DIR: join(data, "releases", pair.release),
          GAIA_GENERATION: join(data, "generations", pair.generation),
          GAIA_DATA_DIR: data,
          GAIA_CREDENTIALS: join(data, "credentials/oauth.sqlite"),
          GAIA_HOST: host,
          GAIA_PORT: String(port),
          GAIA_CONTROL_SOCKET: this.socket,
          GAIA_PROBE_TOKEN: this.token,
        },
      },
    );
    this.child = child;
    if (child.pid)
      await atomic(join(data, "control/child.json"), {
        pid: child.pid,
        marker: `--managed-child=${data}`,
      });
    child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
    await waitHealth(
      this.base,
      pair.release,
      this.options.bootTimeout ?? 15000,
    );
  }
  private async bootRecovering() {
    for (;;) {
      try {
        await this.boot();
        return;
      } catch (error) {
        await this.halt();
        await this.persist({
          ...this.state,
          failures: this.state.failures + 1,
        });
        if (this.state.kind === "safe") throw error;
        if (this.state.failures >= 3)
          await this.pinSafe("Child boot failures. Self-change disabled.");
      }
    }
  }
  private async halt() {
    const child = this.child;
    this.child = undefined;
    if (child) await stop(child);
    await rm(join(this.options.data, "control/child.json"), { force: true });
  }
  private async watch() {
    if (this.busy || this.watching || this.closing || !this.child) return;
    this.watching = true;
    const child = this.child;
    try {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          const response = await fetch(this.base + "/healthz", {
            signal: AbortSignal.timeout(1500),
          });
          if (response.ok) return;
        } catch {
          /* An unresponsive child is a failed child too. */
        }
      }
      if (this.busy || this.closing || this.child !== child) return;
      this.busy = true;
      try {
        await this.halt();
        await this.persist({
          ...this.state,
          failures: this.state.failures + 1,
        });
        if (this.state.failures >= 3)
          await this.pinSafe("Child crash loop. Self-change disabled.");
        await this.bootRecovering();
      } finally {
        this.busy = false;
      }
    } finally {
      this.watching = false;
    }
  }
  async handle(input: Command): Promise<unknown> {
    if (input.kind === "status")
      return {
        version: 1,
        ...this.state,
        busy: this.busy,
        selfModification: this.state.kind !== "safe",
      };
    if (input.kind === "history") return { version: 1, changes: this.history };
    if (input.kind === "design") return { design: await designPack(join(this.options.data, "releases", this.state.active.release), this.options.core) };
    if (input.kind === "read") {
      const root = join(
        this.options.data,
        "releases",
        this.state.active.release,
      );
      return {
        path: input.path,
        text: await readFile(await safeFile(root, input.path), "utf8"),
      };
    }
    if (this.busy)
      throw new Error(
        "Another change or reversion is in progress. Retry later.",
      );
    if (this.state.kind === "safe")
      throw new Error(
        "Self-change is disabled in safe mode. Review the failures locally.",
      );
    this.busy = true;
    if (input.kind === "stage") {
      try {
        return await this.stage(input.reason, input.edits);
      } finally {
        this.busy = false;
      }
    }
    try {
      let entry: Change;
      if (input.kind === "revert") {
        const original = this.history.find(
          (change) => change.id === input.id && change.outcome === "accepted",
        );
        if (!original) throw new Error("Accepted change not found");
        entry = await this.revert(original);
      } else {
        const staged = this.history.find(
          (change) => change.id === input.id && change.outcome === "staged",
        );
        if (!staged) throw new Error("Staged change not found");
        entry = staged;
      }
      if (entry.base !== this.state.active.release)
        throw new Error("Stale proposal. Stage again from the active release.");
      entry.outcome = "queued";
      entry.detail =
        "Checks queued. Deployment waits for the current reply to finish.";
      await this.saveHistory();
      setImmediate(() => {
        void this.promote(entry)
          .finally(() => {
            this.busy = false;
          })
          .catch((error) =>
            process.stderr.write(`Promotion error ${String(error)}\n`),
          );
      });
      return entry;
    } catch (error) {
      this.busy = false;
      throw error;
    }
  }
  private async stage(reason: string, edits: Edit[]) {
    const { data, dependencies } = this.options;
    const id = randomUUID();
    const stage = join(data, "staging", id);
    for (const edit of edits) await safeFile(join(data, "repo"), edit.path);
    await command(
      "git",
      ["worktree", "add", "--detach", stage, this.state.active.release],
      join(data, "repo"),
    );
    await symlink(dependencies, join(stage, "node_modules"));
    for (const edit of edits) {
      const path = await safeFile(stage, edit.path);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, patchText("text" in edit ? "" : await readFile(path, "utf8"), edit));
    }
    await verifyProtected(stage, this.protected);
    await command(
      "git",
      ["add", "--", ...edits.map((edit) => edit.path)],
      stage,
    );
    const diff = await command(
      "git",
      ["diff", "--cached", "--no-ext-diff"],
      stage,
    );
    if (!diff) throw new Error("No source change");
    const entry: Change = {
      id,
      reason,
      at: new Date().toISOString(),
      base: this.state.active.release,
      commit: null,
      diff,
      checks: [],
      outcome: "staged",
      detail: "Source staged in an isolated worktree.",
    };
    this.history.push(entry);
    await this.saveHistory();
    return entry;
  }
  private async revert(original: Change) {
    const { data, dependencies } = this.options;
    const id = randomUUID();
    const stage = join(data, "staging", id);
    const repo = join(data, "repo");
    await command(
      "git",
      ["worktree", "add", "--detach", stage, this.state.active.release],
      repo,
    );
    await symlink(dependencies, join(stage, "node_modules"));
    const patch = await command(
      "git",
      [
        "diff",
        "--binary",
        "--full-index",
        original.commit ?? "",
        original.base,
      ],
      repo,
      120000,
      true,
    );
    const patchPath = join(stage, ".revert.patch");
    await writeFile(patchPath, patch);
    await command("git", ["apply", "--3way", "--index", patchPath], stage);
    await verifyProtected(stage, this.protected);
    const diff = await command(
      "git",
      ["diff", "--cached", "--no-ext-diff"],
      stage,
    );
    if (!diff) throw new Error("This change is already reverted.");
    const entry: Change = {
      id,
      reason: `Revert ${original.id}: ${original.reason}`,
      at: new Date().toISOString(),
      base: this.state.active.release,
      commit: null,
      diff,
      checks: [],
      outcome: "staged",
      detail: "Exact reverse patch staged.",
    };
    this.history.push(entry);
    await this.saveHistory();
    return entry;
  }
  private async drain() {
    const until = Date.now() + 120000;
    while (Date.now() < until) {
      const response = await fetch(this.base + "/api/v1/state", {
        signal: AbortSignal.timeout(2000),
      });
      const value = await response.json();
      if (value.thread.run.kind !== "running") {
        const child = this.child;
        if (!child)
          throw new Error("Managed child is missing before shutdown.");
        await quiesce(
          child,
          {
            release: this.state.active.release,
            generation: join(
              this.options.data,
              "generations",
              this.state.active.generation,
            ),
          },
          this.options.quiesceTimeout,
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Current reply did not finish before deployment deadline");
  }
  private async promote(entry: Change) {
    const { data, core, dependencies } = this.options;
    const previous = this.state.active;
    const good = this.state.good;
    const stage = join(data, "staging", entry.id);
    let switching = false;
    try {
      await this.persist({
        kind: "checking",
        active: previous,
        good,
        failures: this.state.failures,
        change: entry.id,
      });
      entry.outcome = "checking";
      await this.saveHistory();
      await verifyProtected(stage, this.protected);
      await recipe({
        stage,
        core,
        dependencies,
        release: previous.release,
        record: async (result) => {
          entry.checks.push(result);
          await this.saveHistory();
        },
      });
      await verifyProtected(stage, this.protected);
      await command(
        "git",
        [
          "commit",
          "-qm",
          `${entry.reason}\n\nTrusted checks:\n${entry.checks.join("\n")}\nOutcome recorded in local supervisor history.`,
        ],
        stage,
      );
      const commit = await command("git", ["rev-parse", "HEAD"], stage);
      entry.commit = commit;
      const candidate: Pair = {
        release: commit,
        generation: randomUUID(),
        schema: 1,
      };
      await command(
        "git",
        ["worktree", "move", stage, join(data, "releases", commit)],
        join(data, "repo"),
      );
      await this.persist({
        kind: "switching",
        active: previous,
        previous,
        candidate,
        good,
        failures: this.state.failures,
        change: entry.id,
      });
      switching = true;
      await this.drain();
      await this.halt();
      await cp(
        join(data, "generations", previous.generation),
        join(data, "snapshots", entry.id),
        { recursive: true },
      );
      await cp(
        join(data, "snapshots", entry.id),
        join(data, "generations", candidate.generation),
        { recursive: true },
      );
      await this.persist({
        kind: "probing",
        active: candidate,
        previous,
        candidate,
        good,
        failures: this.state.failures,
        change: entry.id,
      });
      await this.boot();
      await probes(this.base, commit, this.token, this.options.probeTimeout);
      await compatible(
        join(data, "snapshots", entry.id),
        join(data, "generations", candidate.generation),
      );
      entry.checks.push(
        "public health, scripted chat and SSE reconnect: passed",
      );
      await this.persist({
        kind: "stable",
        active: candidate,
        receipt: {
          id: entry.id,
          outcome: "accepted",
          commit,
          detail: "Code and conversation generation promoted.",
        },
        good,
        failures: 0,
      });
      entry.outcome = "accepted";
      entry.detail = "Code and conversation generation promoted.";
    } catch (error) {
      const outcome = switching ? "rolled-back" : "rejected";
      entry.detail = String(error).slice(-16000);
      const failures = this.state.failures + 1;
      if (switching) await this.halt();
      await this.persist({
        kind: "stable",
        active: previous,
        good,
        failures,
        receipt: {
          id: entry.id,
          outcome,
          detail: entry.detail,
          commit: entry.commit,
        },
      });
      if (failures >= 3) {
        await this.halt();
        await this.pinSafe(
          "Three consecutive failed promotions. Self-change disabled.",
        );
        await this.bootRecovering();
      } else if (switching) await this.bootRecovering();
      entry.outcome = outcome;
    } finally {
      await this.saveHistory();
      if (entry.commit)
        await command(
          "git",
          [
            "notes",
            "append",
            "-m",
            JSON.stringify({
              id: entry.id,
              checks: entry.checks,
              outcome: entry.outcome,
              detail: entry.detail,
            }),
            entry.commit,
          ],
          join(data, "repo"),
        );
    }
  }
  async close() {
    this.closing = true;
    if (this.watcher) clearInterval(this.watcher);
    await this.halt();
    await new Promise<void>((resolve) =>
      this.controlServer.close(() => resolve()),
    );
  }
}
