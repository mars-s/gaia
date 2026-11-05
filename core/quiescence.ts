import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const Binding = z.object({
  version: z.literal(1),
  requestId: z.string().uuid(),
  release: z.string().min(1),
  generation: z.string().min(1),
});
export const QuiesceRequest = Binding.extend({
  kind: z.literal("gaia.quiesce"),
}).strict();
export const QuiesceReceipt = Binding.extend({
  kind: z.literal("gaia.quiesced"),
}).strict();
type Receipt = z.infer<typeof QuiesceReceipt>;

export async function quiesce(
  child: ChildProcess,
  binding: Pick<Receipt, "release" | "generation">,
  timeout = 120000,
): Promise<Receipt> {
  const request = QuiesceRequest.parse({
    ...binding,
    version: 1,
    kind: "gaia.quiesce",
    requestId: randomUUID(),
  });
  return new Promise((resolve, reject) => {
    let receipt: Receipt | undefined;
    const finish = (result: Receipt | Error) => {
      clearTimeout(timer);
      child.off("message", receive);
      child.off("close", closed);
      child.off("error", failed);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const failed = (error: Error) => finish(error);
    const receive = (value: unknown) => {
      const parsed = QuiesceReceipt.safeParse(value);
      if (!parsed.success || parsed.data.requestId !== request.requestId)
        return;
      if (
        parsed.data.release !== request.release ||
        parsed.data.generation !== request.generation
      ) {
        finish(new Error("Shutdown receipt names a different generation."));
        return;
      }
      receipt = parsed.data;
    };
    const closed = (code: number | null, signal: NodeJS.Signals | null) => {
      if (code !== 0 || signal !== null)
        finish(new Error(`Managed shutdown failed (${code ?? signal}).`));
      else if (!receipt)
        finish(new Error("Managed child exited without a shutdown receipt."));
      else finish(receipt);
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error("Managed child did not finish whole-runtime shutdown."),
        ),
      timeout,
    );
    child.on("message", receive);
    child.once("close", closed);
    child.once("error", failed);
    if (!child.connected) {
      finish(new Error("Managed child IPC is unavailable for shutdown."));
      return;
    }
    child.send(request, (error) => {
      if (error) finish(error);
    });
  });
}
