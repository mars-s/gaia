import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { installCore, hashes } from "../../core/install.ts";
import { type recipe } from "../../core/recipe.ts";
import { gates } from "./model.ts";
import { git } from "./source.ts";
import { readJson, stat, writeJson } from "./files.ts";
import { z } from "zod";

export const fakeManifest = {
  name: "gaia-owner-fixture",
  private: true,
  dependencies: {
    "@earendil-works/pi-ai": "1.5.0",
    "@earendil-works/pi-durable": "1.5.0",
    esbuild: "0.28.2",
  },
  devDependencies: { electron: "45.2.2" },
};

export async function fakeInputs(
  directory: string,
  changed = false,
  additions: Record<string, string> = {},
) {
  await mkdir(directory, { recursive: true });
  const manifest = {
    ...fakeManifest,
    dependencies: { ...fakeManifest.dependencies, ...additions },
    description: changed ? "owner-reviewed metadata" : "baseline",
  };
  await writeJson(join(directory, "package.json"), manifest);
  await writeJson(join(directory, "package-lock.json"), {
    name: manifest.name,
    lockfileVersion: 3,
    ownerFixture: changed ? "next" : "before",
    packages: {
      "": manifest,
      ...Object.fromEntries(
        Object.entries({
          ...manifest.dependencies,
          ...manifest.devDependencies,
        }).map(([name, version]) => [
          `node_modules/${name}`,
          {
            version,
            resolved: `https://registry.npmjs.org/${name}/fixture.tgz`,
            integrity: "sha512-synthetic-test-only",
          },
        ]),
      ),
    },
  });
}

export async function fakeInstaller(directory: string) {
  const modules = join(directory, "node_modules");
  const manifest = (await stat(join(directory, "package.json")))
    ? z
        .object({
          dependencies: z.record(z.string(), z.string()),
          devDependencies: z.record(z.string(), z.string()),
        })
        .parse(await readJson(join(directory, "package.json")))
    : fakeManifest;
  for (const [name, version] of Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })) {
    await mkdir(join(modules, name), { recursive: true });
    await writeJson(join(modules, name, "package.json"), { name, version });
  }
  await mkdir(join(modules, "esbuild/bin"));
  await writeFile(
    join(modules, "esbuild/bin/esbuild"),
    "#!/bin/sh\nprintf '0.28.2\\n'\n",
  );
  await chmod(join(modules, "esbuild/bin/esbuild"), 0o700);
  await mkdir(join(modules, "electron/dist"));
  await writeFile(
    join(modules, "electron/dist/electron"),
    "synthetic executable marker",
  );
  await chmod(join(modules, "electron/dist/electron"), 0o700);
  await writeFile(join(modules, "electron/dist/version"), "45.2.2");
  await writeFile(join(modules, "electron/path.txt"), "electron");
  await writeFile(
    join(modules, "electron/index.js"),
    "module.exports = require('node:path').join(__dirname, 'dist/electron');\n",
  );
}

export const fixtureChecks: typeof recipe = async ({ stage, record }) => {
  await mkdir(join(stage, "dist"));
  await writeFile(join(stage, "dist/index.html"), "synthetic built bytes");
  for (const gate of gates) await record(gate);
};

export async function fixture(
  dependencyKind: "directory" | "symlink" = "directory",
) {
  const root = await mkdtemp(
    join(
      process.platform === "darwin" ? "/private/tmp" : tmpdir(),
      "gaia-owner-",
    ),
  );
  const source = join(root, "source");
  const data = join(root, "data");
  await fakeInputs(source);
  for (const path of [
    "core",
    "packages/protocol",
    "apps/server",
    "apps/web",
    "selfmod",
  ])
    await mkdir(join(source, path), { recursive: true });
  for (const path of [
    "core/child.ts",
    "core/auth.ts",
    "core/watchdog.ts",
    "packages/protocol/index.ts",
    "apps/server/server.ts",
    "apps/web/index.ts",
    "selfmod/client.ts",
  ])
    await writeFile(join(source, path), "export const baseline = true;\n");
  await writeJson(join(source, "tsconfig.json"), { compilerOptions: {} });
  for (const name of ["eslint.config.js", "vite.config.ts", "LICENSE"])
    await writeFile(join(source, name), "fixture\n");
  await git(source, ["init", "-q"]);
  await git(source, ["config", "user.name", "Synthetic owner"]);
  await git(source, ["config", "user.email", "owner@localhost"]);
  await git(source, ["add", "."]);
  await git(source, ["commit", "-qm", "Synthetic baseline"]);
  for (const name of [
    "control",
    "credentials",
    "dependencies",
    "protected",
    "generations",
    "releases",
  ])
    await mkdir(join(data, name), { recursive: true, mode: 0o700 });
  if (dependencyKind === "directory")
    await fakeInstaller(join(data, "dependencies"));
  else {
    await fakeInstaller(join(root, "previous-dependencies"));
    await symlink(
      join(root, "previous-dependencies/node_modules"),
      join(data, "dependencies/node_modules"),
    );
  }
  const oldCore = join(data, "protected/baseline");
  await installCore(source, oldCore, join(data, "dependencies/node_modules"));
  const repo = join(data, "repo");
  await git(data, ["clone", "-q", "--no-hardlinks", source, repo]);
  const release = await git(repo, ["rev-parse", "HEAD"]);
  const releaseDirectory = join(data, "releases", release);
  await git(repo, ["worktree", "add", "--detach", releaseDirectory, release]);
  const generation = randomUUID();
  const generationDirectory = join(data, "generations", generation);
  await mkdir(generationDirectory);
  const db = new DatabaseSync(join(generationDirectory, "gaia.sqlite"));
  db.exec(
    "PRAGMA user_version=1; CREATE TABLE messages (id INTEGER PRIMARY KEY, text TEXT NOT NULL); CREATE INDEX message_text ON messages(text); CREATE TABLE profile (kind TEXT NOT NULL); INSERT INTO messages VALUES(1,'Synthetic history retained'),(2,'Exact reply 🌱'); INSERT INTO profile VALUES('skipped');",
  );
  db.close();
  const pi = new DatabaseSync(join(generationDirectory, "pi.sqlite"));
  pi.exec(
    "CREATE TABLE conversations (id TEXT PRIMARY KEY, state TEXT NOT NULL); INSERT INTO conversations VALUES('fixture','retained');",
  );
  pi.close();
  const credentials = new DatabaseSync(join(data, "credentials/oauth.sqlite"));
  credentials.exec(
    "CREATE TABLE credentials (provider TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO credentials VALUES('fixture-marker','synthetic-only');",
  );
  credentials.close();
  const pair = { release, generation, schema: 1 };
  await writeJson(join(data, "control/core.json"), oldCore);
  await writeJson(join(data, "control/protected.json"), await hashes(repo));
  await writeJson(join(data, "control/manifest.json"), {
    kind: "stable",
    active: pair,
    good: pair,
    failures: 0,
  });
  await writeFile(join(data, "control/history.json"), "[  ]\n");
  const beforeCredential = await readFile(
    join(data, "credentials/oauth.sqlite"),
  );
  return { root, source, data, oldCore, generationDirectory, beforeCredential };
}

export async function changeSource(source: string, corePaths: string[] = []) {
  await fakeInputs(source, true);
  for (const path of corePaths) {
    await mkdir(join(source, path, ".."), { recursive: true });
    await writeFile(join(source, path), "export const ownerReviewed = true;\n");
  }
  await git(source, ["add", "."]);
  await git(source, ["commit", "-qm", "Owner reviewed upgrade"]);
}

export async function copyRealInputs(source: string, destination: string) {
  await mkdir(destination, { recursive: true });
  for (const name of ["package.json", "package-lock.json"])
    await cp(join(source, name), join(destination, name));
}
