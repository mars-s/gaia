import { DesignTurns } from "./self-change-turns.ts";
import { z } from "zod";
import { defineExtension, LiveDoc, section, type Extension, type ToolExecutionResult } from "@earendil-works/pi-durable";

export { ChangeCritique as Critique } from "../../packages/protocol/change-preview.ts";
import { ChangeCritique as Critique, type ChangeSource } from "../../packages/protocol/change-preview.ts";
export type Critique = z.infer<typeof Critique>;
export { criticPrompt, reviewPreview } from "../../core/critic.ts";
import { reviewPreview } from "../../core/critic.ts";

export function reviewedSelfChange(extension: Extension, source?: (conversation: string) => ChangeSource | undefined | Promise<ChangeSource | undefined>): Extension {
  if (!extension.tools?.some(tool => tool.name === "self_change")) return extension;
  const turns = new DesignTurns();
  const loops = new Map<string, { turn: string; count: number; lastStage?: string }>();
  return defineExtension({ ...extension,
    sections: [...(extension.sections ?? []), section("gaia-ui-review", () => 'For apps/web changes use stage, then {"kind":"preview","id":"UUID"} before submit. Preview supplies fixture images and a separate advisory critic. Revise with another stage when useful, then preview again. At most three previews per request. After the third submit the last previewed stage even with open design issues. Mechanical failures must be fixed; critic scores never block. New stages replace earlier proposals in this revision loop. Never claim deployment before accepted history.')],
    tools: extension.tools.map(tool => tool.name !== "self_change" ? tool : { ...tool, async execute(args, api, context) {
      const { command } = z.object({ command: z.string() }).parse(args);
      const input = z.object({ kind: z.string() }).passthrough().parse(JSON.parse(command));
      const live = await api.snapshot(LiveDoc, api.conversationId, context), turn = String(live?.run?.first ?? api.taskId), key = String(api.conversationId);
      const state = loops.get(key)?.turn === turn ? loops.get(key)! : { turn, count: 0 };
      const attachDesign = async (result: ToolExecutionResult): Promise<ToolExecutionResult> => {
        const edits = z.array(z.object({path: z.string()})).safeParse(input.edits);
        const ui = (input.kind === "read" && typeof input.path === "string" && input.path.startsWith("apps/web/")) || (input.kind === "stage" && edits.success && edits.data.some(edit => edit.path.startsWith("apps/web/")));
        if (!ui || result.isError || !turns.first(key, turn)) return result;
        const first = result.output?.find(block => block.type === "text");
        if (first?.type !== "text") return result;
        let attachment: {design?: unknown; designError?: string};
        try {
          const pack = await tool.execute({ command: JSON.stringify({kind:"design"}) }, api, context);
          if (pack.isError) throw new Error("Design pack unavailable");
          const text = pack.output?.find(block => block.type === "text");
          if (text?.type !== "text") throw new Error("Design pack unavailable");
          attachment = {design: JSON.parse(text.text)};
        } catch {
          turns.forget(key);
          attachment = {designError: "Design pack unavailable. The command succeeded."};
        }
        return {...result, output: result.output?.map(block => block === first ? {...block, text: JSON.stringify({result: JSON.parse(first.text), ...attachment})} : block)};
      };

      if (input.kind === "stage") {
        if (state.count >= 3) return { output: [{ type: "text", text: "Three preview attempts reached. Submit the last matching preview, or report the remaining mechanical failure." }], isError: true };
        const origin = await source?.(key), stageInput = { ...input, ...(origin ? { source: origin } : {}) };
        const result = await tool.execute({ ...z.record(z.string(), z.unknown()).parse(args), command: JSON.stringify(stageInput) }, api, context);
        const first = result.output?.find(block => block.type === "text");
        if (first?.type === "text") {
          const raw = z.object({ result: z.unknown().optional() }).passthrough().parse(JSON.parse(first.text));
          const value = z.object({ id: z.string().uuid() }).safeParse(raw.result ?? raw);
          if (value.success && !result.isError) {
            const older = state.lastStage;
            state.lastStage = value.data.id;
            if (older && older !== value.data.id) {
              try { await tool.execute({command: JSON.stringify({kind:"discard", id:older})}, api, context); }
              catch { /* The new stage remains available if old-draft cleanup fails. */ }
            }
          }
        }
        loops.set(key, state); return attachDesign(result);
      }
      if (input.kind !== "preview") return attachDesign(await tool.execute(args, api, context));
      if (state.count >= 3) return { output: [{ type: "text", text: "Three preview attempts reached. Submit the last matching preview, or report the remaining mechanical failure." }], isError: true };
      state.count++; loops.set(key, state);
      if (loops.size > 128) loops.delete(loops.keys().next().value ?? "");
      const result = await tool.execute(args, api, context);
      if (result.isError) return result;
      if (extension.name === "gaia-self-change") return { ...result, output: [...(result.output ?? []), { type: "text", text: JSON.stringify({ previewAttempt: state.count, next: state.count === 3 ? "Submit this stage. Design issues are advisory." : "Revise if useful, otherwise submit." }) }] };
      try {
        const critique = await reviewPreview({ models: api.models, model: (await api.agent(context)).model, output: result.output });
        const metadata = result.output?.find(block => block.type === "text");
        if (metadata?.type === "text") {
          const record = z.object({ id: z.string().uuid(), previews: z.object({ hash: z.string() }) }).safeParse(JSON.parse(metadata.text));
          if (record.success) await tool.execute({ command: JSON.stringify({ kind: "review", id: record.data.id, hash: record.data.previews.hash, critique }) }, api, context);
        }
        return { ...result, output: [...(result.output ?? []), { type: "text", text: JSON.stringify({ critique, previewAttempt: state.count, next: state.count === 3 ? "Submit this stage. Design issues are advisory." : "Revise if useful, otherwise submit." }) }] };
      } catch {
        return { ...result, output: [...(result.output ?? []), { type: "text", text: "The separate plan review was unavailable. Preview checks passed. You may submit; no critic score was recorded." }] };
      }
    } }),
  });
}
