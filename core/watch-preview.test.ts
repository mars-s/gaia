import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, symlink, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { previewFixture } from "./preview.test.ts";
import { importable } from "./install.ts";
import { Change } from "./state.ts";
import { stop, command } from "./process.ts";

test(
  "watchdog restarts a crashed child while a real preview is rendering",
  { skip: process.platform !== "darwin", timeout: 180000 },
  async () => {
    const f = await previewFixture();
    const child = () =>
      spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        stdio: "ignore",
        detached: true,
      });
    let preview: Promise<unknown> | undefined;
    try {
      const change = Change.parse(
        await f.supervisor.handle({
          kind: "stage",
          reason: "Watch proof",
          edits: [{ path: "apps/web/fixture.css", text: "changed" }],
        }),
      );
      const stage = join(f.data, "staging", change.id);
      for (const target of [f.repo, stage]) {
        for (const path of [
          "apps",
          "packages",
          "core",
          "selfmod",
          "package.json",
          "tsconfig.json",
        ])
          await cp(resolve(path), join(target, path), {
            recursive: true,
            filter: importable,
          });
        if (target === f.repo)
          await symlink(resolve("node_modules"), join(target, "node_modules"));
      }
      const active = join(f.data, "releases", change.base);
      await rm(active);
      await cp(f.repo, active, { recursive: true, filter: importable });
      await symlink(resolve("node_modules"), join(active, "node_modules"));
      await command("git", ["add", "."], stage);
      await mkdir(join(f.data, "control"), { recursive: true });
      f.supervisor.child = child();
      const crashed = f.supervisor.child;
      let restarted = false;
      Object.defineProperty(f.supervisor, "bootRecovering", {
        value: async () => {
          f.supervisor.child = child();
          restarted = true;
        },
      });
      preview = f.supervisor.handle({
        kind: "preview",
        id: change.id,
      });
      void preview.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 100));
      crashed.kill("SIGKILL");
      await once(crashed, "exit");
      const watch = Reflect.get(f.supervisor, "watch") as () => Promise<void>;
      await watch.call(f.supervisor);
      assert(restarted, "a preview must not pause crash recovery");
      assert.notEqual(f.supervisor.child?.pid, crashed.pid);
      const result = Change.parse(await preview);
      assert.equal(result.previews?.shots.length, 20);
    } finally {
      await preview?.catch(() => {});
      if (f.supervisor.child) await stop(f.supervisor.child);
      await rm(f.data, { recursive: true, force: true });
    }
  },
);
