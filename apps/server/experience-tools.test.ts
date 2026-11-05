import { canSignalOwnedChild } from "./experience-tools/test-support.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  writeFile,
  readdir,
  readFile,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import {
  Harness,
  createRegistry,
  ROOT_CONVERSATION_ID,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import {
  createExperienceToolHost,
  findDesktopImage,
} from "./experience-tools/index.ts";

test(
  "guardian loss cannot produce a clean shutdown with a live owned command",
  { timeout: 15000 },
  async (t) => {
    if (!(await canSignalOwnedChild()))
      return t.skip(
        "Protected candidate sandbox denies signalling owned processes.",
      );
    const dir = await mkdtemp(join(tmpdir(), "gaia-host-guardian-loss-"));
    const host = await createExperienceToolHost({
      receiptDirectory: join(dir, "receipts"),
      generation: "fixture",
      mode: "stable",
      enabled: () => true,
      platform: "darwin",
    });
    const faux = fauxProvider({
      models: [{ id: "test" }],
      tokensPerSecond: 100000,
    });
    const models = createModels();
    models.setProvider(faux.provider);
    const registry = createRegistry();
    registry.install(
      host.extension({
        profileId: randomUUID(),
        scopeId: randomUUID(),
        jobId: randomUUID(),
        generation: "fixture",
        conversationId: ROOT_CONVERSATION_ID,
      }),
    );
    const harness = await Harness.open(
      await openNodeSqliteStorage(join(dir, "pi.sqlite")),
      {
        models,
        registry,
        settings: { retry: { maxRetries: 0 }, compaction: { enabled: false } },
      },
      ctx,
    );
    const owned: { pid: number | undefined } = { pid: undefined };
    t.after(async () => {
      if (owned.pid) {
        try {
          process.kill(-owned.pid, "SIGKILL");
        } catch {
          /* Already joined. */
        }
      }
      await harness.close(ctx);
      await rm(dir, { recursive: true, force: true });
    });
    const root = await harness.root(ctx, {
      agent: { model: { provider: faux.provider.id, modelId: "test" } },
    });
    const marker = join(dir, "started.json");
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(
            "mac_shell",
            {
              activity: "Holding the owned shutdown fixture",
              executable: process.execPath,
              args: [
                "-e",
                `const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,guardian:process.ppid,descendant:c.pid}));setInterval(()=>{},1000)`,
              ],
              cwd: dir,
            },
            { id: "guardian-loss" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("The external outcome is uncertain."),
    ]);
    await root.submit(
      { type: "input", content: "Hold the owned fixture" },
      ctx,
    );
    const Started = z.object({
      pid: z.number().int().positive(),
      guardian: z.number().int().positive(),
      descendant: z.number().int().positive(),
    });
    let started: z.infer<typeof Started> | undefined;
    for (let i = 0; i < 200; i++) {
      try {
        started = Started.parse(JSON.parse(await readFile(marker, "utf8")));
      } catch {
        /* Wait for the owned command. */
      }
      if (started) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert(started);
    const commandPid = started.pid;
    owned.pid = commandPid;
    await new Promise((resolve) => setTimeout(resolve, 50));
    process.kill(started.guardian, "SIGKILL");
    await root.waitForIdle(ctx);
    assert.equal(host.receipts()[0]?.state, "unknown");
    let closed = false;
    try {
      await host.close();
      closed = true;
    } catch (error) {
      assert.match(String(error), /termination remains unverified/);
    }
    let live = false;
    try {
      live = !execFileSync(
        "/bin/ps",
        ["-p", String(commandPid), "-o", "stat="],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      )
        .trim()
        .startsWith("Z");
    } catch {
      /* Reaped. */
    }
    assert.equal(
      closed && live,
      false,
      "A live native command cannot cross a clean shutdown barrier.",
    );
    assert.equal(
      closed,
      true,
      "The retained process-group identity supports joined fallback cleanup.",
    );
    assert.equal(live, false);
    let descendantLive = false;
    try {
      descendantLive = !execFileSync(
        "/bin/ps",
        ["-p", String(started.descendant), "-o", "stat="],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      )
        .trim()
        .startsWith("Z");
    } catch {
      /* Reaped. */
    }
    assert.equal(descendantLive, false);
  },
);

test(
  "real Pi invocation binds receipts, blocks replay and obeys dynamic dispatch gate",
  { timeout: 15000 },
  async (t) => {
    if (!(await canSignalOwnedChild()))
      return t.skip(
        "Protected candidate sandbox denies signalling owned processes.",
      );
    const dir = await mkdtemp(join(tmpdir(), "gaia-host-"));
    const receipts = join(dir, "receipts");
    let enabled = true;
    const desktopExecutable = join(dir, "desktop-fixture.mjs");
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString(
      "base64",
    );
    await writeFile(
      desktopExecutable,
      `#!${process.execPath}\nconsole.log(JSON.stringify({ok:true,data:${JSON.stringify(png)}}));`,
    );
    await chmod(desktopExecutable, 0o700);
    const binding = {
      profileId: randomUUID(),
      scopeId: randomUUID(),
      jobId: randomUUID(),
      generation: "test-generation",
      conversationId: ROOT_CONVERSATION_ID,
    };
    const host = await createExperienceToolHost({
      receiptDirectory: receipts,
      generation: binding.generation,
      mode: "stable",
      desktopExecutable,
      enabled: () => enabled,
      platform: "darwin",
    });
    const models = createModels();
    const faux = fauxProvider({
      models: [{ id: "test" }],
      tokensPerSecond: 100000,
    });
    models.setProvider(faux.provider);
    const extension = host.extension(binding);
    const registry = createRegistry();
    registry.install(extension);
    const harness = await Harness.open(
      await openNodeSqliteStorage(join(dir, "pi.sqlite")),
      {
        models,
        registry: registry,
        settings: { retry: { maxRetries: 0 }, compaction: { enabled: false } },
      },
      ctx,
    );
    t.after(async () => {
      await host.close();
      await harness.close(ctx);
      await rm(dir, { recursive: true, force: true });
    });
    const root = await harness.root(ctx, {
      agent: { model: { provider: faux.provider.id, modelId: "test" } },
    });
    const args = {
      activity: "Checking the owned process fixture",
      executable: process.execPath,
      args: ["-e", "process.stdout.write('owned result')"],
      cwd: dir,
    };
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("mac_shell", args, { id: "call-1" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    await root.submit({ type: "input", content: "Run fixture" }, ctx);
    await root.waitForIdle(ctx);
    const [receipt] = host.receipts();
    assert.ok(
      receipt,
      JSON.stringify(await root.entries({}, 100, undefined, ctx)),
    );
    assert.equal(receipt.state, "completed");
    assert.equal(receipt.identity.jobId, binding.jobId);
    assert.equal(receipt.identity.callId, "call-1");
    assert.match(JSON.stringify(receipt.result), /owned result/);
    assert.equal(host.activeInvocationCount, 0);
    enabled = false;
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("mac_shell", args, { id: "call-2" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("gate checked"),
    ]);
    await root.submit({ type: "input", content: "Gate fixture" }, ctx);
    await root.waitForIdle(ctx);
    assert.equal(host.receipts().length, 2);
    assert.equal(
      host.receipts().find((item) => item.identity.callId === "call-2")?.state,
      "failed",
    );
    assert.equal(host.capabilities().machine, false);
    enabled = true;
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("mac_shell", args, { id: "call-1" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("replay checked"),
    ]);
    await root.submit({ type: "input", content: "Replay fixture" }, ctx);
    await root.waitForIdle(ctx);
    assert.equal(host.receipts().length, 2);
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(
            "agent_desktop",
            {
              activity: "Inspecting the owned screenshot fixture",
              args: ["screenshot"],
              cwd: dir,
            },
            { id: "screen-1" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("image inspected"),
    ]);
    await root.submit({ type: "input", content: "Screenshot fixture" }, ctx);
    await root.waitForIdle(ctx);
    assert.equal(host.receipts().length, 3);
    const imageReceipt = host
      .receipts()
      .find((item) => item.tool === "agent_desktop");
    assert.match(JSON.stringify(imageReceipt?.result), /image\/png/);
    assert.match(
      JSON.stringify(await root.entries({}, 100, undefined, ctx)),
      /image\/png/,
    );
    await writeFile(
      desktopExecutable,
      `#!${process.execPath}\nconsole.log('Usage: agent-desktop <command>');`,
    );
    for (const [command, expected] of [
      ["help", "completed"],
      ["snapshot", "failed"],
    ]) {
      const callId = `plain-${command}`;
      faux.setResponses([
        fauxAssistantMessage(
          [
            fauxToolCall(
              "agent_desktop",
              {
                activity: "Reading desktop command guidance",
                args: [command],
                cwd: dir,
              },
              { id: callId },
            ),
          ],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("Inspected command guidance"),
      ]);
      await root.submit(
        { type: "input", content: "Inspect plain desktop output" },
        ctx,
      );
      await root.waitForIdle(ctx);
      assert.equal(
        host.receipts().find((receipt) => receipt.identity.callId === callId)
          ?.state,
        expected,
      );
    }
    const marker = join(dir, "quiesce-started");
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(
            "mac_shell",
            {
              ...args,
              args: [
                "-e",
                `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ready');setInterval(()=>{},1000)`,
              ],
            },
            { id: "quiesce-1" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("stopped"),
    ]);
    await root.submit({ type: "input", content: "Owned quiesce fixture" }, ctx);
    let ready = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        ready = (await readFile(marker, "utf8")) === "ready";
      } catch {
        /* Wait for the owned child to start. */
      }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert(ready);
    assert.equal(host.activeInvocationCount, 1);
    await host.quiesce();
    assert.equal(host.activeInvocationCount, 0);
    await root.waitForIdle(ctx);
    assert.equal(
      host.receipts().find((receipt) => receipt.identity.callId === "quiesce-1")
        ?.state,
      "cancelled",
    );
    assert.equal(host.capabilities().search, false);
  },
);
test("intent recovery is unknown, disabled modes have no capability and PNG is model-visible", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-receipts-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const identity = {
    profileId: randomUUID(),
    scopeId: randomUUID(),
    jobId: randomUUID(),
    generation: "old",
    conversationId: 1,
    callId: "call",
    taskId: 2,
  };
  const key = createHash("sha256")
    .update(JSON.stringify({ ...identity, taskId: undefined }))
    .digest("hex");
  await writeFile(
    join(dir, key + ".json"),
    JSON.stringify({
      identity,
      tool: "mac_shell",
      description: "Updating an owned fixture",
      state: "intent",
      at: new Date().toISOString(),
    }),
  );
  const host = await createExperienceToolHost({
    receiptDirectory: dir,
    generation: "new",
    mode: "stable",
  });
  assert.equal(host.receipts()[0].state, "unknown");
  assert.equal(host.capabilities().machine, false);
  await host.close();
  assert.equal((await readdir(dir)).length, 1);
  for (const mode of ["candidate", "probe", "safe"] as const) {
    const disabled = await createExperienceToolHost({
      receiptDirectory: join(dir, mode),
      generation: "new",
      mode,
      enabled: () => true,
    });
    assert.deepEqual(disabled.capabilities(), {
      machine: false,
      desktop: false,
      search: false,
      selfModification: false,
    });
    await disabled.close();
  }
  let currentMode: "candidate" | "stable" = "candidate";
  const changing = await createExperienceToolHost({
    receiptDirectory: join(dir, "changing"),
    generation: "new",
    mode: () => currentMode,
    enabled: () => true,
    platform: "darwin",
  });
  assert.equal(changing.capabilities().machine, false);
  currentMode = "stable";
  assert.equal(changing.capabilities().machine, true);
  await changing.close();
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
  assert.equal(findDesktopImage(png), png);
  assert.equal(findDesktopImage({ screenshot: { base64: png } }), png);
  assert.equal(findDesktopImage({ path: "/tmp/cannot-see.png" }), undefined);
});
