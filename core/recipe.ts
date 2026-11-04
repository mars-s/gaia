import { join } from "node:path";
import { writeFile, readdir, readFile } from "node:fs/promises";
import { command } from "./process.ts";
import { sandboxProfile, candidateBoot } from "./sandbox.ts";
export async function sourceFiles(
  root: string,
  directory = "",
): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(root, directory), {
    withFileTypes: true,
  })) {
    const path = join(directory, entry.name);
    if (entry.name === "integrity.json") continue;
    if (
      entry.name.startsWith(".") ||
      ["node_modules", "dist", "data"].includes(entry.name)
    )
      continue;
    if (entry.isSymbolicLink()) throw new Error(`Symlink refused: ${path}`);
    if (entry.isDirectory()) result.push(...(await sourceFiles(root, path)));
    else result.push(path);
  }
  return result;
}
export async function recipe({
  stage,
  core,
  dependencies,
  release,
  record,
}: {
  stage: string;
  core: string;
  dependencies: string;
  release: string;
  record: (result: string) => Promise<void>;
}) {
  const profile = await sandboxProfile(stage, core, dependencies);
  const bin = (path: string) => join(dependencies, path);
  const run = async (name: string, args: string[]) => {
    try {
      await command(
        "/usr/bin/sandbox-exec",
        ["-f", profile, process.execPath, ...args],
        stage,
      );
      await record(`${name}: passed`);
    } catch (error) {
      await record(`${name}: failed`);
      throw error;
    }
  };
  const config = JSON.parse(
    await readFile(join(core, "tsconfig.json"), "utf8"),
  );
  config.compilerOptions.paths = { "@/*": [join(stage, "apps/web/*")] };
  config.include = [
    join(stage, "apps"),
    join(stage, "packages"),
    join(stage, "core"),
    join(stage, "selfmod"),
  ];
  await writeFile(
    join(stage, ".trusted-tsconfig.json"),
    JSON.stringify(config),
  );
  await run("typecheck", [
    bin("typescript/bin/tsc"),
    "--project",
    join(stage, ".trusted-tsconfig.json"),
    "--noEmit",
  ]);
  await run("lint", [
    bin("eslint/bin/eslint.js"),
    "--no-config-lookup",
    "--config",
    join(core, "eslint.config.js"),
    "apps",
    "packages",
    "core",
    "selfmod",
  ]);
  const tests = (await sourceFiles(stage, "apps/server")).filter((path) =>
    path.endsWith(".test.ts"),
  );
  await run("unit tests", [
    "--import",
    bin("tsx/dist/loader.mjs"),
    "--test",
    ...tests,
  ]);
  await run("build", [
    "--import",
    bin("tsx/dist/loader.mjs"),
    bin("vite/bin/vite.js"),
    "build",
    "--config",
    join(core, "core/trusted/vite.config.ts"),
    "--configLoader",
    "runner",
  ]);
  await candidateBoot({ stage, core, dependencies, release });
  await record("sandbox boot and isolation: passed");
  await run("protocol conformance", [
    "--import",
    bin("tsx/dist/loader.mjs"),
    join(core, "core/conformance.ts"),
    stage,
  ]);
}
