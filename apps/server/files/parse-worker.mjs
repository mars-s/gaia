import { parentPort, workerData } from "node:worker_threads";
import { parseFile } from "./parse.ts";
try {
  parentPort.postMessage({ ok: true, parsed: await parseFile(workerData) });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error:
      error instanceof Error ? error.message : "This file could not be read.",
  });
}
