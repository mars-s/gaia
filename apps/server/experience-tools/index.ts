import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, readdir } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import {
  defineExtension,
  section,
  type ToolExecutionApi,
  type ToolExecutionResult,
} from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import { z } from "zod";
import { defineClassifiedTool } from "./effect-class.ts";
import { DesktopLease } from "./lease.ts";
import {
  NativeProcessFailure,
  ProcessResult,
  runGuardedProcess,
} from "./process.ts";
import { searchWeb } from "./search.ts";

const Binding = z.object({
  profileId: z.string().uuid(),
  scopeId: z.string().uuid(),
  jobId: z.string().uuid(),
  generation: z.string().min(1),
  conversationId: z.number().int().nonnegative(),
});
export type ToolBinding = z.infer<typeof Binding>;
const Identity = Binding.extend({
  callId: z.string().min(1),
  taskId: z.number().int().nonnegative(),
});
const Receipt = z.object({
  identity: Identity,
  tool: z.enum(["search_web", "mac_shell", "agent_desktop"]),
  description: z.string(),
  state: z.enum(["intent", "completed", "failed", "cancelled", "unknown"]),
  at: z.string(),
  effectClass: z.enum(["read", "effect"]).optional(),
  dispatched: z.boolean().optional(),
  result: z.json().optional(),
  message: z.string().optional(),
});
export type ToolReceipt = z.infer<typeof Receipt>;
type ReceiptEvidence = Pick<
  ToolReceipt,
  "state" | "effectClass" | "dispatched"
>;
const dispatchObservers = new WeakMap<ToolExecutionApi, () => Promise<void>>();
export function observeEffectDispatch(
  api: ToolExecutionApi,
  observer: () => Promise<void>,
) {
  dispatchObservers.set(api, observer);
  return () => dispatchObservers.delete(api);
}
const resultReceipts = new WeakMap<ToolExecutionResult, ReceiptEvidence>();
export function receiptEvidence(result: ToolExecutionResult) {
  return resultReceipts.get(result);
}

export class ToolInvocationFailure extends Error {
  constructor(readonly receipt: ToolReceipt) {
    super(receipt.message ?? "Tool invocation failed.");
  }
}
const Activity = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .describe(
    "Concise activity text describing the purpose and target for the owner, without raw commands.",
  );
const Execution = {
  activity: Activity,
  cwd: z.string().refine(isAbsolute),
  timeoutMs: z.number().int().min(10).max(300000).default(60000),
};
const Shell = z.strictObject({
  ...Execution,
  executable: z.string().min(1),
  args: z.array(z.string()).max(256),
});
const Desktop = z.strictObject({
  ...Execution,
  args: z.array(z.string()).min(1).max(256),
});
const Search = z.strictObject({
  activity: Activity,
  query: z.string().trim().min(1).max(16000),
});

export type ExperienceToolHostOptions = {
  receiptDirectory: string;
  generation: string;
  mode:
    | "stable"
    | "candidate"
    | "probe"
    | "safe"
    | (() => "stable" | "candidate" | "probe" | "safe");
  enabled?: () => boolean;
  platform?: NodeJS.Platform;
  desktopExecutable?: string;
  onReceipt?: (receipt: ToolReceipt) => void | Promise<void>;
};

export async function createExperienceToolHost(
  options: ExperienceToolHostOptions,
) {
  const desktop = new DesktopLease();
  const calls = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  let closed = false;
  const unjoined = new Set<string>();
  const receipts = new Map<string, ToolReceipt>();
  await mkdir(options.receiptDirectory, { recursive: true, mode: 0o700 });
  const keyFor = (identity: z.infer<typeof Identity>) =>
    createHash("sha256")
      .update(JSON.stringify({ ...identity, taskId: undefined }))
      .digest("hex");
  async function persist(key: string, receipt: ToolReceipt) {
    const path = join(options.receiptDirectory, key + ".json");
    const temporary = path + "." + randomUUID();
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(receipt));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    const dir = await open(options.receiptDirectory, "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
    receipts.set(key, receipt);
    await options.onReceipt?.(structuredClone(receipt));
  }
  for (const name of await readdir(options.receiptDirectory)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const receipt = Receipt.parse(
      JSON.parse(await readFile(join(options.receiptDirectory, name), "utf8")),
    );
    const key = name.slice(0, -5);
    receipts.set(key, receipt);
    if (receipt.state === "intent")
      await persist(key, {
        ...receipt,
        state: receipt.effectClass === "read" ? "cancelled" : "unknown",
        at: new Date().toISOString(),
        message:
          receipt.effectClass === "read"
            ? "Read-only invocation interrupted before settlement. It can be retried."
            : "Owner stopped before settlement. External outcome is unknown. Do not replay automatically.",
      });
  }
  function capabilities() {
    const enabled =
      !closed &&
      !unjoined.size &&
      (typeof options.mode === "function" ? options.mode() : options.mode) ===
        "stable" &&
      (options.enabled?.() ?? false);
    const machine =
      enabled && (options.platform ?? process.platform) === "darwin";
    return {
      machine,
      desktop: machine,
      search: enabled,
      selfModification: false,
    };
  }
  function check(binding: ToolBinding, machine: boolean) {
    if (binding.generation !== options.generation)
      throw new Error("Tool generation expired.");
    if (!(machine ? capabilities().machine : capabilities().search))
      throw new Error("Tool host is disabled.");
    if (
      machine &&
      [...receipts.values()].some(
        (receipt) =>
          receipt.identity.jobId === binding.jobId &&
          receipt.state === "unknown" &&
          receipt.effectClass !== "read",
      )
    )
      throw new Error(
        "Review the unknown effect before dispatching further machine tools for this job.",
      );
  }
  async function invoke(
    binding: ToolBinding,
    tool: ToolReceipt["tool"],
    description: string,
    api: ToolExecutionApi,
    context: Context,
    execute: (
      signal: AbortSignal,
      started: () => Promise<void>,
    ) => Promise<ToolExecutionResult>,
  ): Promise<ToolExecutionResult> {
    if (api.conversationId !== binding.conversationId)
      throw new Error("Tool conversation does not match its job binding.");
    const identity = Identity.parse({
      ...binding,
      callId: api.callId,
      taskId: api.taskId,
    });
    const key = keyFor(identity);
    if (receipts.has(key) || calls.has(key))
      throw new Error(
        "Invocation already recorded. Read its receipt; do not replay an uncertain effect.",
      );
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      ...(context.abortSignal ? [context.abortSignal] : []),
    ]);
    let finish = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    calls.set(key, { controller, done });
    const intent: ToolReceipt = {
      identity,
      tool,
      description,
      state: "intent",
      effectClass: tool === "search_web" ? "read" : "effect",
      dispatched: false,
      at: new Date().toISOString(),
    };
    let dispatched = false;
    try {
      check(binding, tool !== "search_web");
      await persist(key, intent);
      signal.throwIfAborted();
      const result = await execute(signal, async () => {
        check(binding, tool !== "search_web");
        signal.throwIfAborted();
        await api.details(
          {
            identity,
            description,
            stage: "running",
            kind:
              tool === "search_web"
                ? "search"
                : tool === "mac_shell"
                  ? "machine"
                  : "desktop",
          },
          context,
        );
        check(binding, tool !== "search_web");
        signal.throwIfAborted();
        dispatched = true;
        intent.dispatched = true;
        if (intent.effectClass === "effect") {
          await persist(key, intent);
        }
      });
      const processReason = nativeReason(result);
      if (processReason === "spawn_error") intent.dispatched = false;
      const receipt: ToolReceipt = {
        ...intent,
        state:
          intent.dispatched &&
          tool !== "search_web" &&
          (signal.aborted ||
            processReason === "timeout" ||
            processReason === "cancelled" ||
            processReason === "owner_lost")
            ? "unknown"
            : signal.aborted
              ? "cancelled"
              : result.isError
                ? "failed"
                : "completed",
        at: new Date().toISOString(),
        result: z.json().parse(result),
      };
      if (receipt.state === "unknown")
        receipt.message =
          "The process group joined, but its external effect may already have occurred. Review before repeating.";
      await persist(key, receipt);
      if (receipt.state === "unknown") throw new ToolInvocationFailure(receipt);
      resultReceipts.set(result, {
        state: receipt.state,
        effectClass: receipt.effectClass,
        dispatched: receipt.dispatched,
      });
      return result;
    } catch (error) {
      if (error instanceof ToolInvocationFailure) throw error;
      if (
        error instanceof NativeProcessFailure &&
        error.lifetime === "unjoined"
      )
        unjoined.add(key);
      const message = error instanceof Error ? error.message : String(error);
      const failure: ToolReceipt = {
        ...intent,
        state:
          dispatched && tool !== "search_web"
            ? "unknown"
            : signal.aborted
              ? "cancelled"
              : "failed",
        at: new Date().toISOString(),
        message,
      };
      await persist(key, failure);
      throw new ToolInvocationFailure(failure);
    } finally {
      calls.delete(key);
      finish();
    }
  }
  function extension(value: ToolBinding, provider?: string) {
    const binding = Object.freeze(Binding.parse(value));
    return defineExtension({
      name: `gaia-experience-tools-${binding.jobId}`,
      sections:
        provider === "openai-codex"
          ? []
          : [
              section(
                "hosted-search-availability",
                () =>
                  "Hosted web search is unavailable for this model in Gaia. Choose a ChatGPT model to use hosted search. Do not claim to have searched the web.",
              ),
            ],
      tools: [
        defineClassifiedTool("read", {
          name: "search_web",
          description:
            "Search the live web using the calling Codex subscription model. Returns verified hosted search evidence and clickable source citations.",
          parameters: z.toJSONSchema(Search),
          replay: "unsafe",
          async execute(input, api, context) {
            const args = Search.parse(input);
            return invoke(
              binding,
              "search_web",
              args.activity,
              api,
              context,
              async (signal, started) => {
                await started();
                const result = await searchWeb(
                  args.query,
                  api,
                  context,
                  signal,
                );
                return {
                  output: [
                    {
                      type: "text",
                      text:
                        result.text +
                        "\n\n" +
                        result.citations
                          .map(
                            (citation) =>
                              `[${citation.title || citation.url}](${citation.url})`,
                          )
                          .join("\n") +
                        "\n\n" +
                        JSON.stringify(result),
                    },
                  ],
                  details: {
                    description: args.activity,
                    stage: "completed",
                    citations: result.citations,
                  },
                };
              },
            );
          },
        }),
        defineClassifiedTool("effect", {
          name: "mac_shell",
          description:
            "Run an unrestricted owner-level executable with structured argv and an absolute per-call cwd. For shell syntax explicitly invoke /bin/zsh with -c. Output is bounded; cancellation joins the process group.",
          parameters: z.toJSONSchema(Shell, { io: "input" }),
          replay: "unsafe",
          async execute(input, api, context) {
            const args = Shell.parse(input);
            return invoke(
              binding,
              "mac_shell",
              args.activity,
              api,
              context,
              async (signal, started) => {
                await started();
                const result = await runGuardedProcess({
                  ...args,
                  signal,
                  maxBytes: 48000,
                  onStarted: () => dispatchObservers.get(api)?.(),
                });
                return {
                  output: [{ type: "text", text: JSON.stringify(result) }],
                  isError: result.code !== 0 || result.reason !== "exited",
                  details: {
                    description: args.activity,
                    stage: signal.aborted ? "cancelled" : "settled",
                    processReason: result.reason,
                  },
                };
              },
            );
          },
        }),
        defineClassifiedTool("effect", {
          name: "agent_desktop",
          description:
            "Use Agent Desktop with structured CLI arguments under the shared desktop lease. Read help and snapshot first. For screenshot omit PATH to return model-visible PNG. All profiles share one cursor. Never automatically repeat an uncertain action.",
          parameters: z.toJSONSchema(Desktop, { io: "input" }),
          replay: "unsafe",
          outputLimits: { maxBytes: 16000000, maxLines: 10000 },
          async execute(input, api, context) {
            const args = Desktop.parse(input);
            return invoke(
              binding,
              "agent_desktop",
              args.activity,
              api,
              context,
              (signal, started) =>
                desktop.use(signal, async () => {
                  await started();
                  const result = await runGuardedProcess({
                    ...args,
                    executable: options.desktopExecutable ?? "agent-desktop",
                    signal,
                    maxBytes: 12000000,
                    onStarted: () => dispatchObservers.get(api)?.(),
                  });
                  const output: NonNullable<ToolExecutionResult["output"]> = [];
                  let envelope: unknown;
                  try {
                    envelope = JSON.parse(result.stdout);
                  } catch {
                    /* Non-JSON CLI diagnostics remain model-visible. */
                  }
                  const parsed = z
                    .object({ ok: z.boolean(), data: z.unknown().optional() })
                    .safeParse(envelope);
                  const helpRequested =
                    args.args[0] === "help" ||
                    args.args.includes("--help") ||
                    args.args.includes("-h");
                  const image = findDesktopImage(
                    parsed.success ? parsed.data.data : undefined,
                  );
                  if (image)
                    output.push({
                      type: "image",
                      data: image,
                      mimeType: "image/png",
                    });
                  output.push({
                    type: "text",
                    text: JSON.stringify(
                      image
                        ? { ...result, stdout: "[PNG image attached]" }
                        : result,
                    ),
                  });
                  return {
                    output,
                    isError:
                      result.code !== 0 ||
                      result.reason !== "exited" ||
                      (parsed.success ? !parsed.data.ok : !helpRequested),
                    details: {
                      description: args.activity,
                      stage: signal.aborted ? "cancelled" : "settled",
                      processReason: result.reason,
                    },
                  };
                }),
            );
          },
        }),
      ].filter(
        (tool) => tool.name !== "search_web" || provider === "openai-codex",
      ),
    });
  }
  async function quiesce() {
    closed = true;
    for (const call of calls.values())
      call.controller.abort(new Error("Tool host quiescing."));
    await Promise.all([...calls.values()].map((call) => call.done));
    if (unjoined.size)
      throw new Error(
        "Native process termination remains unverified. Refuse a clean shutdown receipt.",
      );
  }
  return {
    extension,
    capabilities,
    get activeInvocationCount() {
      return calls.size;
    },
    receipts: () => structuredClone([...receipts.values()]),
    quiesce,
    close: quiesce,
  };
}

export function findDesktopImage(
  value: unknown,
  depth = 0,
): string | undefined {
  if (depth > 6) return;
  if (typeof value === "string") {
    const data = value.replace(/^data:image\/png;base64,/, "");
    if (
      data.length <= 11000000 &&
      /^[A-Za-z0-9+/=\r\n]+$/.test(data) &&
      Buffer.from(data, "base64")
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      return data;
    return;
  }
  const record = z.record(z.string(), z.unknown()).safeParse(value);
  if (!record.success) return;
  for (const child of Object.values(record.data)) {
    const found = findDesktopImage(child, depth + 1);
    if (found) return found;
  }
}

function nativeReason(result: ToolExecutionResult) {
  const details = z
    .object({
      processReason: ProcessResult.shape.reason,
    })
    .safeParse(result.details);
  return details.success ? details.data.processReason : undefined;
}
