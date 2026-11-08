import { z } from "zod";
import { open, readFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  ChangeCritique,
  ChangeSource,
} from "../packages/protocol/change-preview.ts";
import { Surfaces } from "./render/schema.ts";
export const Pair = z.object({
  release: z.string().regex(/^[a-f0-9]{40}$/),
  generation: z.string().uuid(),
  schema: z.literal(1),
});
export type Pair = z.infer<typeof Pair>;
const Receipt = z.object({
  id: z.string().uuid(),
  outcome: z.enum(["accepted", "rejected", "rolled-back"]),
  detail: z.string(),
  commit: z.string().nullable(),
});
const Base = {
  receipt: Receipt.optional(),
  active: Pair,
  good: Pair,
  failures: z.number().int().nonnegative(),
};
export const State = z.discriminatedUnion("kind", [
  z.object({ ...Base, kind: z.literal("stable") }),
  z.object({ ...Base, kind: z.literal("safe"), reason: z.string() }),
  z.object({ ...Base, kind: z.literal("checking"), change: z.string().uuid() }),
  z.object({
    ...Base,
    kind: z.literal("switching"),
    change: z.string().uuid(),
    previous: Pair,
    candidate: Pair,
  }),
  z.object({
    ...Base,
    kind: z.literal("probing"),
    change: z.string().uuid(),
    previous: Pair,
    candidate: Pair,
  }),
]);
export type State = z.infer<typeof State>;
export const Edit = z.union([
  z
    .object({ path: z.string().min(1).max(240), text: z.string().max(200000) })
    .strict(),
  z
    .object({
      path: z.string().min(1).max(240),
      find: z.string().min(1).max(200000),
      replace: z.string().max(200000),
    })
    .strict(),
]);
export type Edit = z.infer<typeof Edit>;
export function patchText(source: string, edit: Edit) {
  if ("text" in edit) return edit.text;
  const first = source.indexOf(edit.find);
  if (first < 0 || source.indexOf(edit.find, first + 1) >= 0)
    throw new Error(`Patch requires exactly one match: ${edit.path}`);
  const result =
    source.slice(0, first) +
    edit.replace +
    source.slice(first + edit.find.length);
  if (result.length > 200000)
    throw new Error(`Patched file too large: ${edit.path}`);
  return result;
}
export const Command = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status") }),
  z.object({ kind: z.literal("history") }),
  z.object({ kind: z.literal("design") }),
  z.object({ kind: z.literal("read"), path: z.string() }),
  z.object({
    kind: z.literal("stage"),
    reason: z.string().min(1).max(1000),
    source: ChangeSource.optional(),
    edits: z.array(Edit).min(1).max(30),
  }),
  z.object({
    kind: z.literal("image"),
    id: z.string().uuid(),
    file: z.string().regex(/^(before|after)-[a-z0-9-]+\.jpg$/),
  }),
  z.object({
    kind: z.literal("review"),
    id: z.string().uuid(),
    hash: z.string(),
    critique: ChangeCritique,
  }),
  z.object({
    kind: z.literal("preview"),
    id: z.string().uuid(),
  }),
  z.object({ kind: z.literal("discard"), id: z.string().uuid() }),
  z.object({ kind: z.literal("submit"), id: z.string().uuid() }),
  z.object({ kind: z.literal("revert"), id: z.string().uuid() }),
]);
export type Command = z.infer<typeof Command>;
export const Preview = z.object({
  hash: z.string(),
  surfaces: Surfaces,
  shots: z.array(
    z.object({
      name: z.string(),
      scenario: z.string(),
      width: z.number(),
      theme: z.enum(["light", "dark"]),
      before: z.string(),
      after: z.string(),
    }),
  ),
  alsoChanged: z.array(z.string()),
});
export const Change = z.object({
  id: z.string().uuid(),
  reason: z.string(),
  at: z.string(),
  base: z.string(),
  commit: z.string().nullable(),
  diff: z.string(),
  checks: z.array(z.string()),
  outcome: z.enum([
    "staged",
    "queued",
    "checking",
    "accepted",
    "rejected",
    "rolled-back",
    "interrupted",
  ]),
  detail: z.string(),
  previews: Preview.optional(),
  critique: ChangeCritique.optional(),
  source: ChangeSource.optional(),
});
export type Change = z.infer<typeof Change>;
export async function atomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.new`;
  const file = await open(temporary, "w", 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
export async function readState(data: string) {
  return State.parse(
    JSON.parse(await readFile(`${data}/control/manifest.json`, "utf8")),
  );
}
