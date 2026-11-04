import {
  closeSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  fchmodSync,
  fsyncSync,
  writeFileSync,
  fstatSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  OwnerProfile,
  OwnerState,
  OwnerAnswerUpdate,
  type OwnerAnswers,
} from "../../packages/sdk/onboarding.ts";

export function openOwnerProfile(db: DatabaseSync) {
  const main = z.object({ name: z.literal("main"), file: z.string() }).parse(
    db
      .prepare("PRAGMA database_list")
      .all()
      .find((row) => row.name === "main"),
  );
  if (!isAbsolute(main.file) || basename(main.file) !== "gaia.sqlite")
    throw new Error("Owner profile requires a file-backed gaia.sqlite.");
  const path = join(dirname(main.file), "owner-profile.json");
  function read(): OwnerState {
    let fd: number;
    try {
      fd = openSync(path, "r");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return { kind: "new" };
      throw error;
    }
    try {
      if (fstatSync(fd).size > 16384)
        throw new Error("Owner profile is too large.");
      return OwnerState.parse(JSON.parse(readFileSync(fd, "utf8")));
    } finally {
      closeSync(fd);
    }
  }
  function write(value: OwnerState) {
    read();
    const content = JSON.stringify(OwnerState.parse(value));
    const temporary = join(dirname(path), `.owner-profile-${randomUUID()}.tmp`);
    const fd = openSync(temporary, "wx", 0o600);
    try {
      fchmodSync(fd, 0o600);
      writeFileSync(fd, content);
      fsyncSync(fd);
      renameSync(temporary, path);
    } finally {
      closeSync(fd);
      rmSync(temporary, { force: true });
    }
  }
  return {
    read,
    record(answers: OwnerAnswers) {
      const state = read();
      if (state.kind !== "interview") throw new Error("Setup is not active.");
      write({
        ...state,
        answers: { ...state.answers, ...OwnerAnswerUpdate.parse(answers) },
      });
    },
    propose(profile: OwnerProfile) {
      const state = read();
      if (state.kind !== "interview") throw new Error("Setup is not active.");
      const proposed = OwnerProfile.parse(profile);
      write({
        kind: "proposed",
        proposalId: randomUUID(),
        profile: OwnerProfile.parse({ ...proposed, ...state.answers }),
      });
    },
    action(action: string, proposalId?: string) {
      const state = read();
      switch (action) {
        case "start":
          if (state.kind !== "new" && state.kind !== "skipped") return false;
          write({
            kind: "interview",
            answers: {},
            startedAt: new Date().toISOString(),
          });
          break;
        case "edit":
          if (state.kind !== "proposed") return false;
          write({
            kind: "interview",
            answers: state.profile,
            startedAt: new Date().toISOString(),
          });
          break;
        case "confirm":
          if (state.kind !== "proposed" || state.proposalId !== proposalId)
            return false;
          write({ kind: "ready", profile: state.profile });
          break;
        case "skip":
          if (state.kind === "ready") return false;
          write({ kind: "skipped" });
          break;
        case "reset":
          rmSync(path, { force: true });
          break;
        default:
          return false;
      }
      return true;
    },
  };
}
