import { Worker } from "node:worker_threads";
import { z } from "zod";
import { ParsedFile, fileLimits } from "../../../packages/protocol/files.ts";

const Reply = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), parsed: ParsedFile }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export function parseInWorker(
  bytes: Uint8Array,
  timeoutMs: number = fileLimits.timeoutMs,
): Promise<ParsedFile> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./parse-worker.mjs", import.meta.url), {
      workerData: bytes,
      resourceLimits: {
        maxOldGenerationSizeMb: fileLimits.workerHeapMb,
        stackSizeMb: 4,
      },
    });
    const finish = (error?: Error, value?: ParsedFile) => {
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else if (value) resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error("This file took too long to parse.")),
      timeoutMs,
    );
    worker.once("message", (message: unknown) => {
      const result = Reply.safeParse(message);
      if (!result.success)
        finish(new Error("The file parser returned invalid data."));
      else if (result.data.ok) finish(undefined, result.data.parsed);
      else finish(new Error(result.data.error));
    });
    worker.once("error", () =>
      finish(new Error("The file parser exceeded its limits or stopped.")),
    );
    worker.once("exit", (code) => {
      if (code !== 0) finish(new Error("The file parser stopped."));
    });
  });
}
