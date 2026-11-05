import { randomUUID } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { z } from "zod";
import {
  ProposalMetadata,
  ExperienceMain,
} from "../../../packages/protocol/experiences.ts";
function read<T>(path: string, schema: z.ZodType<T>): T | undefined {
  try {
    return schema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
function write(path: string, value: unknown) {
  const temporary = path + "." + randomUUID() + ".tmp";
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  const fd = openSync(temporary, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
  const directory = openSync(dirname(path), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
export function setupSidecars(directory: string) {
  return {
    proposal: (id: string) =>
      read(join(directory, id, "proposal.json"), ProposalMetadata),
    saveProposal: (id: string, value: ProposalMetadata) =>
      write(
        join(directory, id, "proposal.json"),
        ProposalMetadata.parse(value),
      ),
    main: () =>
      read(join(directory, "main.json"), ExperienceMain) ?? {
        version: 1 as const,
        profileId: null,
        setAt: new Date(0).toISOString(),
      },
    saveMain: (value: z.infer<typeof ExperienceMain>) =>
      write(join(directory, "main.json"), ExperienceMain.parse(value)),
  };
}
