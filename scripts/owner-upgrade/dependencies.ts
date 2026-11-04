import { cp, mkdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { command } from "../../core/process.ts";
import { type Dependency } from "./model.ts";
import {
  digest,
  equal,
  fingerprint,
  noLinks,
  readJson,
  stat,
  writeBytes,
  writeJson,
} from "./files.ts";

const versions = z.record(z.string(), z.string());
const Manifest = z.object({
  dependencies: versions.default({}),
  devDependencies: versions.default({}),
  optionalDependencies: versions.default({}),
});
const LockPackage = z.object({
  version: z.string().optional(),
  integrity: z.string().optional(),
  resolved: z.string().optional(),
  optional: z.boolean().optional(),
  link: z.boolean().optional(),
  inBundle: z.boolean().optional(),
  dependencies: versions.optional(),
  devDependencies: versions.optional(),
  optionalDependencies: versions.optional(),
});
const Lock = z.object({
  lockfileVersion: z.literal(3),
  packages: z.record(z.string(), LockPackage),
});
const Ready = z
  .object({
    manifestHash: z.string(),
    lockHash: z.string(),
    node: z.string(),
    platform: z.string(),
    arch: z.string(),
    readiness: z.literal("npm-ci-and-installed-versions"),
  })
  .strict();
const pins = {
  "@earendil-works/pi-ai": "1.5.0",
  "@earendil-works/pi-durable": "1.5.0",
  electron: "45.2.2",
};
const sections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
] as const;
export type Installer = (directory: string) => Promise<void>;

export const npmCi: Installer = async (directory) => {
  const userConfig = join(directory, ".npmrc-user");
  const globalConfig = join(directory, ".npmrc-global");
  await writeBytes(userConfig, "");
  await writeBytes(globalConfig, "");
  await command(
    "npm",
    [
      "ci",
      "--include=dev",
      "--include=optional",
      "--ignore-scripts=false",
      "--no-audit",
      "--no-fund",
      "--registry=https://registry.npmjs.org/",
      `--userconfig=${userConfig}`,
      `--globalconfig=${globalConfig}`,
      `--cache=${join(directory, ".npm-cache")}`,
      "--fetch-retries=1",
      "--fetch-timeout=60000",
    ],
    directory,
    600000,
  );
  await command(
    process.execPath,
    ["-e", "require('electron')"],
    directory,
    300000,
  );
};

export async function manifests(before: string, after: string) {
  const old = Manifest.parse(await readJson(join(before, "package.json")));
  const next = Manifest.parse(await readJson(join(after, "package.json")));
  for (const [name, version] of Object.entries(pins)) {
    for (const manifest of [old, next]) {
      const matches = sections.flatMap((section) =>
        manifest[section][name] === undefined ? [] : [manifest[section][name]],
      );
      if (matches.length !== 1 || matches[0] !== version)
        throw new Error(`Required exact pin changed: ${name}@${version}`);
    }
  }
  for (const section of sections) {
    for (const [name, version] of Object.entries(old[section]))
      if (next[section][name] !== version)
        throw new Error(`Existing dependency changed or removed: ${name}`);
    for (const [name, version] of Object.entries(next[section]))
      if (
        !(name in old[section]) &&
        !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)
      )
        throw new Error(`New dependency needs an exact version: ${name}`);
  }
}

export async function verifyInstalled(
  manifestDirectory: string,
  modules: string,
) {
  const manifest = Manifest.parse(
    await readJson(join(manifestDirectory, "package.json")),
  );
  const lock = Lock.parse(
    await readJson(join(manifestDirectory, "package-lock.json")),
  );
  const root = Manifest.parse(lock.packages[""]);
  const installedRoot = await realpath(modules);
  if (!equal(root, manifest))
    throw new Error("Lock root dependencies differ from the manifest.");
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === "") continue;
    if (
      !/^node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(
        path,
      ) ||
      entry.link ||
      path.split("/").some((part) => part.startsWith("."))
    )
      throw new Error(`Unsupported dependency lock path: ${path}`);
    const parent =
      lock.packages[path.slice(0, path.lastIndexOf("/node_modules/"))];
    const bundled =
      entry.inBundle &&
      parent?.integrity &&
      parent.resolved?.startsWith("https://registry.npmjs.org/");
    if (
      !entry.version ||
      (!bundled &&
        (!entry.integrity ||
          !entry.resolved?.startsWith("https://registry.npmjs.org/")))
    )
      throw new Error(`Registry integrity required: ${path}`);
    const installed = join(
      installedRoot,
      path.slice("node_modules/".length),
      "package.json",
    );
    if (!(await stat(installed)) && entry.optional) continue;
    await noLinks(installed);
    const pkg = z
      .object({ version: z.string() })
      .parse(JSON.parse(await readFile(installed, "utf8")));
    if (pkg.version !== entry.version)
      throw new Error(
        `Installed dependency version differs from lock: ${path}`,
      );
  }
  for (const [name, version] of Object.entries(pins)) {
    const pkg = z
      .object({ version: z.literal(version) })
      .safeParse(
        JSON.parse(await readFile(join(modules, name, "package.json"), "utf8")),
      );
    if (!pkg.success)
      throw new Error(`Installed exact pin differs: ${name}@${version}`);
  }
  await command(
    join(modules, "esbuild/bin/esbuild"),
    ["--version"],
    manifestDirectory,
  );
  const electronPath = (
    await readFile(join(modules, "electron/path.txt"), "utf8")
  ).trim();
  if (
    !electronPath ||
    electronPath.split(/[\\/]/).some((part) => part === "..") ||
    electronPath.startsWith("/")
  )
    throw new Error("Invalid Electron executable path.");
  const executable = await stat(join(modules, "electron/dist", electronPath));
  if (!executable?.isFile() || !(executable.mode & 0o111))
    throw new Error("Electron installation has no usable executable.");
  if (
    (await readFile(join(modules, "electron/dist/version"), "utf8"))
      .trim()
      .replace(/^v/, "") !== pins.electron
  )
    throw new Error("Electron binary version differs from the required pin.");
  await command(
    process.execPath,
    [
      "-e",
      "const fs=require('node:fs');const p=require(process.argv[1]);if(typeof p!=='string'||fs.realpathSync(p)!==fs.realpathSync(process.argv[2]))throw Error('Electron resolved an unexpected executable')",
      join(modules, "electron"),
      join(modules, "electron/dist", electronPath),
    ],
    manifestDirectory,
    300000,
  );
}

export async function provision({
  data,
  before,
  stage,
  installer = npmCi,
}: {
  data: string;
  before: string;
  stage: string;
  installer?: Installer;
}): Promise<Dependency> {
  await manifests(before, stage);
  await verifyInstalled(before, join(data, "dependencies/node_modules"));
  const manifestHash = await fingerprint(join(stage, "package.json"));
  const lockHash = await fingerprint(join(stage, "package-lock.json"));
  const readiness = "npm-ci-and-installed-versions";
  if (lockHash === (await fingerprint(join(before, "package-lock.json")))) {
    const path = join(data, "dependencies/node_modules");
    await verifyInstalled(stage, path);
    return {
      kind: "current",
      path,
      manifestHash,
      lockHash,
      readiness: "installed-versions-and-binaries",
    };
  }
  const id = digest(
    `${manifestHash}:${lockHash}:${process.platform}:${process.arch}:${process.version}`,
  );
  const directory = join(data, "dependency-sets", id);
  await noLinks(directory);
  const path = join(directory, "node_modules");
  const ready = {
    manifestHash,
    lockHash,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    readiness,
  };
  if (await stat(directory)) {
    if (!(await stat(join(directory, "ready.json"))))
      throw new Error(
        "Dependency set is incomplete. Preserve it and investigate before preparing again.",
      );
    if (
      !equal(Ready.parse(await readJson(join(directory, "ready.json"))), ready)
    )
      throw new Error(
        "Dependency set is incomplete or belongs to another environment. Preserve it and investigate.",
      );
  } else {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const file of ["package.json", "package-lock.json"])
      await cp(join(stage, file), join(directory, file));
    await installer(directory);
    await verifyInstalled(directory, path);
    if (
      (await fingerprint(join(directory, "package.json"))) !== manifestHash ||
      (await fingerprint(join(directory, "package-lock.json"))) !== lockHash
    )
      throw new Error("Installer changed dependency inputs.");
    await writeJson(join(directory, "ready.json"), ready);
  }
  const dependency: Dependency = {
    kind: "set",
    path,
    manifestHash,
    lockHash,
    readiness,
  };
  await verifyDependency(dependency, stage, data);
  return dependency;
}

export async function verifyDependency(
  dependency: Dependency,
  stage: string,
  data: string,
) {
  if (
    (await fingerprint(join(stage, "package.json"))) !==
      dependency.manifestHash ||
    (await fingerprint(join(stage, "package-lock.json"))) !==
      dependency.lockHash
  )
    throw new Error("Dependency input identity changed.");
  if (dependency.kind === "set") {
    const id = digest(
      `${dependency.manifestHash}:${dependency.lockHash}:${process.platform}:${process.arch}:${process.version}`,
    );
    const directory = join(data, "dependency-sets", id);
    if (dependency.path !== join(directory, "node_modules"))
      throw new Error("Dependency set path changed.");
    await noLinks(dependency.path);
    const ready = Ready.parse(await readJson(join(directory, "ready.json")));
    if (
      !equal(ready, {
        manifestHash: dependency.manifestHash,
        lockHash: dependency.lockHash,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        readiness: dependency.readiness,
      })
    )
      throw new Error("Dependency readiness changed.");
    for (const file of ["package.json", "package-lock.json"])
      if (
        (await fingerprint(join(directory, file))) !==
        (await fingerprint(join(stage, file)))
      )
        throw new Error("Dependency set inputs changed.");
  } else if (dependency.path !== join(data, "dependencies/node_modules"))
    throw new Error("Unexpected current dependency path.");
  await verifyInstalled(stage, dependency.path);
}
