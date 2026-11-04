import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";

export const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const Hashes = z.record(z.string(), Hash);
export type Hashes = z.infer<typeof Hashes>;
export const digest = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export const fingerprint = async (path: string) => digest(await readFile(path));
export const missing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

export async function stat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

export function relativeFile(path: string) {
  if (
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => !part || part.startsWith("."))
  )
    throw new Error(`Invalid relative file: ${path}`);
  return path;
}

export async function noLinks(path: string) {
  let cursor: string = sep;
  for (const part of resolve(path).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if ((await stat(cursor))?.isSymbolicLink())
      throw new Error(`Symlink refused: ${cursor}`);
  }
}

export async function dataRoot(path: string) {
  const root = await realpath(resolve(path));
  const info = await lstat(root);
  if (!info.isDirectory())
    throw new Error("DATA must be an existing directory.");
  if (process.getuid && info.uid !== process.getuid())
    throw new Error("Run the upgrade as the filesystem owner of DATA.");
  for (const name of [
    "control",
    "protected",
    "dependencies",
    "repo",
    "releases",
    "generations",
    "operator-upgrades",
    "dependency-sets",
  ])
    await noLinks(join(root, name));
  return root;
}

export async function inventory(
  root: string,
  ignore: ReadonlySet<string> = new Set(),
  prefix = "",
): Promise<Hashes> {
  const files: Hashes = {};
  await noLinks(root);
  for (const entry of (
    await readdir(join(root, prefix), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (ignore.has(path)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Symlink refused: ${path}`);
    if (entry.isDirectory())
      Object.assign(files, await inventory(root, ignore, path));
    else if (entry.isFile()) files[path] = await fingerprint(join(root, path));
    else throw new Error(`Special file refused: ${path}`);
  }
  return files;
}

export function equal(a: unknown, b: unknown) {
  return isDeepStrictEqual(a, b);
}

export function sameHashes(actual: Hashes, expected: Hashes, label: string) {
  const paths = [
    ...new Set([...Object.keys(actual), ...Object.keys(expected)]),
  ].sort();
  for (const path of paths)
    if (actual[path] !== expected[path]) throw new Error(`${label}: ${path}`);
}

export async function syncDirectory(path: string) {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function writeBytes(path: string, bytes: string | Buffer) {
  await noLinks(path);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.new`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await rm(temporary, { force: true });
  }
}

export const writeJson = (path: string, value: unknown) =>
  writeBytes(path, JSON.stringify(value, null, 2));
export const readJson = async (path: string): Promise<unknown> => {
  await noLinks(path);
  return JSON.parse(await readFile(path, "utf8"));
};
