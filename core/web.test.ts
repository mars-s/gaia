import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webResource } from "./web.ts";

test("HTML and retained modules keep their release when the active server changes", async () => {
  const data = await mkdtemp(join(tmpdir(), "gaia-web-"));
  const a = "a".repeat(40);
  const b = "b".repeat(40);
  const options = (release: string) => ({
    data,
    release,
    directory: join(data, "releases", release),
  });
  try {
    for (const release of [a, b]) {
      const root = join(options(release).directory, "dist/web");
      await mkdir(join(root, "assets"), { recursive: true });
      await writeFile(
        join(root, "index.html"),
        '<HEAD></HEAD><meta name="gaia-release" content="untrusted"><script src="./assets/main.js"></script>',
      );
      await writeFile(
        join(root, "assets/main.js"),
        `export const release = '${release}';`,
      );
    }
    const oldHtml = await webResource("/", options(a));
    const asset = /src="([^"]+)"/.exec(oldHtml.body.toString())?.[1];
    assert.equal(asset, `/_gaia/releases/${a}/assets/main.js`);
    const oldModule = await webResource(asset, options(b));
    assert.equal(oldModule.type, "text/javascript");
    assert.equal(oldModule.body.toString(), `export const release = '${a}';`);
    assert.match(
      (await webResource("/", options(b))).body.toString(),
      new RegExp(`/_gaia/releases/${b}/assets/`),
    );
    assert.equal(
      (await webResource(`/assets/missing.js`, options(b))).status,
      404,
    );
    await writeFile(join(data, "private"), "outside");
    await symlink(
      join(data, "private"),
      join(options(a).directory, "dist/web/assets/link.js"),
    );
    for (const path of [
      `/_gaia/releases/${a}/assets/link.js`,
      `/_gaia/releases/${a}/assets/%2e%2e/%2e%2e/private`,
      `/_gaia/releases/invalid/assets/main.js`,
    ])
      assert.equal((await webResource(path, options(b))).status, 404);
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});
