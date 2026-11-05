import { readFileSync } from "node:fs";
import { join } from "node:path";
import { State, type Pair } from "./state.ts";

export function machineGate(
  data: string,
  pair: Pick<Pair, "release" | "generation">,
  probe = false,
) {
  return (): "stable" | "candidate" | "probe" | "safe" => {
    if (probe) return "probe";
    try {
      const state = State.parse(
        JSON.parse(readFileSync(join(data, "control/manifest.json"), "utf8")),
      );
      if (state.kind === "safe") return "safe";
      return state.kind === "stable" &&
        state.active.release === pair.release &&
        state.active.generation === pair.generation
        ? "stable"
        : "candidate";
    } catch {
      return "candidate";
    }
  };
}
