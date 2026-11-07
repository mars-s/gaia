import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { importBaseline, installCore } from "../../core/install.ts";
import { freePort } from "../../core/sandbox.ts";
import { schemas } from "../../core/schema.ts";
import { readState } from "../../core/state.ts";
import { Supervisor } from "../../core/supervisor.ts";
import { npmCi, provision } from "./dependencies.ts";
import { inventory, readJson, writeJson } from "./files.ts";
import { restore } from "./recovery.ts";
import { exportSource, git } from "./source.ts";
import { activate, prepare } from "./upgrade.ts";
import { copyRealInputs } from "./testing.ts";

test(
  "real complete dependency provisioning, seven fixed gates and offline upgrade retain a deterministic chat",
  {
    skip:
      !process.env.GAIA_OWNER_REAL_PROVISION || process.platform !== "darwin",
    timeout: 600000,
  },
  async (t) => {
    const root = await mkdtemp(
      join(
        process.platform === "darwin" ? "/private/tmp" : tmpdir(),
        "gaia-owner-real-",
      ),
    );
    const data = join(root, "data");
    const source = join(root, "source");
    const before = join(root, "baseline-inputs");
    let owner: Supervisor | undefined;
    try {
      for (const name of [
        "control",
        "credentials",
        "dependencies",
        "staging",
        "releases",
        "generations",
        "snapshots",
        "home",
      ])
        await mkdir(join(data, name), { recursive: true, mode: 0o700 });
      await exportSource(resolve("."), source, randomUUID());
      await copyRealInputs(source, before);
      const canonical = join(data, "dependencies/node_modules");
      const previousModules = process.env.GAIA_OWNER_PROOF_MODULES;
      if (!previousModules)
        throw new Error(
          "GAIA_OWNER_PROOF_MODULES must name an existing complete public dependency tree.",
        );
      await symlink(previousModules, canonical);
      const oldCore = join(data, "protected/baseline");
      await installCore(source, oldCore, canonical);
      await writeJson(join(data, "control/core.json"), oldCore);
      await importBaseline(source, data, oldCore, canonical);
      const port = await freePort();
      const base = `http://127.0.0.1:${port}`;
      const boot = async (core: string) => {
        const runtime = new Supervisor({
          data,
          core,
          dependencies: canonical,
          host: "127.0.0.1",
          port,
          testProvider: true,
        });
        await runtime.open();
        return runtime;
      };
      const request = async (
        path: string,
        body?: unknown,
      ): Promise<unknown> => {
        const response = await fetch(
          base + path,
          body === undefined
            ? undefined
            : {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              },
        );
        assert(response.ok, `${path}: ${response.status}`);
        return response.json();
      };
      owner = await boot(oldCore);
      await request("/api/v1/profile/skip", {});
      await request("/api/v1/messages", {
        text: "Synthetic owner upgrade history retained",
        requestId: randomUUID(),
      });
      const ChatState = z.object({
        thread: z.object({
          messages: z.array(z.unknown()),
          run: z.object({ kind: z.string() }),
        }),
      });
      let chat = ChatState.parse(await request("/api/v1/state"));
      const deadline = Date.now() + 10000;
      while (chat.thread.run.kind !== "idle" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        chat = ChatState.parse(await request("/api/v1/state"));
      }
      assert.equal(chat.thread.run.kind, "idle");
      assert.equal(chat.thread.messages.length, 2);
      await owner?.close();
      owner = undefined;
      const credentialsFile = join(data, "credentials/oauth.sqlite");
      const credentials = new DatabaseSync(credentialsFile);
      credentials
        .prepare("INSERT INTO credentials VALUES(?,?)")
        .run("fixture-marker", "synthetic-only");
      credentials.close();
      const credentialBytes = await readFile(credentialsFile);
      const oldState = await readState(data);
      const generation = join(data, "generations", oldState.active.generation);
      const definitions = await schemas(generation);
      const originalFiles = await inventory(generation);
      const manifest = z
        .record(z.string(), z.unknown())
        .parse(await readJson(join(source, "package.json")));
      const lock = z
        .record(z.string(), z.unknown())
        .parse(await readJson(join(source, "package-lock.json")));
      await writeJson(join(source, "package.json"), {
        ...manifest,
        description: "Synthetic complete locked-set proof",
      });
      await writeJson(join(source, "package-lock.json"), {
        ...lock,
        ownerFixture: "Synthetic locked-set proof",
      });
      await git(source, ["add", "package.json", "package-lock.json"]);
      await git(source, ["commit", "-qm", "Synthetic locked set metadata"]);
      let installs = 0;
      const installer = async (directory: string) => {
        installs++;
        const cache = process.env.GAIA_OWNER_ELECTRON_CACHE;
        if (!cache)
          throw new Error(
            "GAIA_OWNER_ELECTRON_CACHE must name the cached Electron 45.2.2 archive directory. No separate binary network download is allowed in this proof.",
          );
        await cp(
          cache,
          join(directory, "Library/Caches/electron", basename(cache)),
          { recursive: true },
        );
        await npmCi(directory);
      };
      const result = await prepare({
        source,
        data,
        installer,
        record: async (check) => {
          t.diagnostic(check);
        },
      });
      assert.equal(installs, 1);
      const reused = await provision({
        data,
        before,
        stage: source,
        installer,
      });
      assert.equal(reused.path, result.dependency.path);
      assert.equal(installs, 1);
      const activated = await activate(result.preparedFile);
      assert.equal(activated.runtimeVerified, false);
      assert.deepEqual(
        await schemas(join(data, "generations", activated.active.generation)),
        definitions,
      );
      assert.deepEqual(await inventory(generation), originalFiles);
      assert.deepEqual(await readFile(credentialsFile), credentialBytes);
      owner = await boot(activated.newCore);
      assert.deepEqual(
        ChatState.parse(await request("/api/v1/state")).thread.messages,
        chat.thread.messages,
      );
      assert.deepEqual(await request("/api/v1/profile"), { kind: "skipped" });
      await owner?.close();
      owner = undefined;
      await restore(activated.journalFile);
      t.diagnostic(
        JSON.stringify({
          completeNpmCi: true,
          electronResolved: true,
          trustedGates: 6,
          newSetReused: true,
          manualDeterministicBoot: true,
          exactMessages: true,
          skippedProfile: true,
          schemaDefinitions: true,
          credentialMarker: true,
          originalGenerationUnchanged: true,
          restored: true,
          providerTraffic: false,
        }),
      );
    } finally {
      await owner?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
