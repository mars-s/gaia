import { createHash } from "node:crypto";
import {
  mkdirSync,
  openSync,
  fsyncSync,
  closeSync,
  lstatSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { ExperienceId } from "../../../packages/protocol/experiences.ts";
export function durableDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Experience directory is invalid.");
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function profileDirectories(root: string) {
  durableDirectory(root);
  return readdirSync(root)
    .filter((name) => ExperienceId.safeParse(name).success)
    .map((id) => ({ id: ExperienceId.parse(id), path: join(root, id) }));
}

export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
