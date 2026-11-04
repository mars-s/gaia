import { z } from "zod";
import { State } from "../../core/state.ts";
import { Hash, Hashes } from "./files.ts";

export const controls = [
  "core.json",
  "protected.json",
  "manifest.json",
  "history.json",
] as const;
export const gates = [
  "typecheck: passed",
  "lint: passed",
  "unit tests: passed",
  "build: passed",
  "sandbox boot and isolation: passed",
  "protocol conformance: passed",
];
export const CoreChange = z
  .object({ path: z.string(), beforeHash: Hash.nullable(), afterHash: Hash })
  .strict();
export type CoreChange = z.infer<typeof CoreChange>;
const dependencyInputs = {
  path: z.string(),
  manifestHash: Hash,
  lockHash: Hash,
};
export const Dependency = z.discriminatedUnion("kind", [
  z
    .object({
      ...dependencyInputs,
      kind: z.literal("current"),
      readiness: z.literal("installed-versions-and-binaries"),
    })
    .strict(),
  z
    .object({
      ...dependencyInputs,
      kind: z.literal("set"),
      readiness: z.literal("npm-ci-and-installed-versions"),
    })
    .strict(),
]);
export type Dependency = z.infer<typeof Dependency>;
export const Identity = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("directory"), dev: z.number(), ino: z.number() })
    .strict(),
  z
    .object({
      kind: z.literal("symlink"),
      dev: z.number(),
      ino: z.number(),
      target: z.string(),
    })
    .strict(),
]);
export type Identity = z.infer<typeof Identity>;
export const DependencySwitch = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unchanged"), original: Identity }).strict(),
  z
    .object({
      kind: z.literal("switch"),
      original: Identity,
      replacement: Identity,
    })
    .strict(),
]);
export type DependencySwitch = z.infer<typeof DependencySwitch>;
export const Prepared = z
  .object({
    version: z.literal(2),
    id: z.string().uuid(),
    data: z.string(),
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
    previous: State,
    previousControls: Hashes,
    oldCore: z.string(),
    oldCoreFiles: Hashes,
    release: z.string().regex(/^[a-f0-9]{40}$/),
    sourceFiles: Hashes,
    protectedFiles: Hashes,
    coreFiles: Hashes,
    coreChanges: z.array(CoreChange),
    allowedCore: z.array(z.string()),
    buildFiles: Hashes,
    dependency: Dependency,
    checks: z.array(z.string()),
    phase: z.literal("prepared"),
  })
  .strict();
export type Prepared = z.infer<typeof Prepared>;
export const Journal = z
  .object({
    version: z.literal(2),
    id: z.string().uuid(),
    data: z.string(),
    previous: State,
    next: State,
    before: Hashes,
    after: Hashes,
    dependency: DependencySwitch,
  })
  .strict();
export type Journal = z.infer<typeof Journal>;

export function locations(data: string, id: string) {
  const directory = `${data}/operator-upgrades/${id}`;
  return {
    directory,
    stage: `${directory}/repo`,
    core: `${directory}/core`,
    prepared: `${directory}/prepared.json`,
    journal: `${directory}/activation.json`,
    backup: `${directory}/previous-control`,
    originalDependencies: `${directory}/previous-node_modules`,
    dependencies: `${data}/dependencies/node_modules`,
    temporaryDependencies: `${data}/dependencies/.owner-${id}`,
    newCore: `${data}/protected/owner-${id}`,
  };
}
