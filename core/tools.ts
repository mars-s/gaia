import {
  defineExtension,
  defineTool,
  section,
  LiveDoc,
} from "@earendil-works/pi-durable";
import { z } from "zod";
import { Command } from "./state.ts";
import { control } from "./control-client.ts";
import { DesignTurns } from "./design/pack.ts";
export function selfChangeTools(socket: string) {
  const turns = new DesignTurns();
  return defineExtension({
    name: "gaia-self-change",
    sections: [
      section(
        "gaia-self-change",
        () =>
          "You are Gaia, using Sol 6.1. For a requested UI or app change, use self_change to read source, stage find-and-replace patches with a reason (find must match exactly once; complete text is also supported), inspect the returned diff, then submit its id. Edits are real source changes in an owned worktree. Submit queues trusted checks and supervised deployment. Never claim the change is live until history says accepted. Use status and history to inspect results. App source changes must use self_change. Other offered machine tools perform owner tasks and do not replace the protected source-change pipeline.",
      ),
    ],
    tools: [
      defineTool({
        name: "self_change",
        description:
          "Read editable source, stage real file changes, inspect history, submit a staged change, or revert an accepted change. All writes go through trusted checks and supervised promotion.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description:
                'JSON command. Use {"kind":"design"} for the current UI design pack. The first UI read or stage in each turn automatically includes it. Examples: {"kind":"read","path":"apps/web/main.tsx"}, {"kind":"stage","reason":"Add a heading","edits":[{"path":"apps/web/main.tsx","find":"exact existing text","replace":"replacement text"}]}, {"kind":"submit","id":"UUID"}, {"kind":"history"}, {"kind":"status"}, {"kind":"revert","id":"UUID"}.',
            },
            activity: {
              type: "string",
              minLength: 1,
              maxLength: 160,
              description:
                "Brief plain-language description of this actual source operation and its target. Supply it when reading, staging, checking or reverting a change.",
            },
          },
          required: ["command"],
          additionalProperties: false,
        },
        async execute(args, api, context) {
          const inputArgs = z
            .object({
              command: z.string(),
              activity: z.string().trim().min(1).max(160).optional(),
            })
            .parse(args);
          if (inputArgs.activity)
            await api.details(
              { description: inputArgs.activity, kind: "file" },
              context,
            );
          const input = Command.parse(JSON.parse(inputArgs.command));
          const result = await control(socket, input);
          const ui = (input.kind === "read" && input.path.startsWith("apps/web/")) || (input.kind === "stage" && input.edits.some(edit => edit.path.startsWith("apps/web/")));
          let design: unknown;
          if (ui) {
            const live = await api.snapshot(LiveDoc, api.conversationId, context);
            const turn = String(live?.run?.first ?? live?.run?.inputs.join(",") ?? api.taskId);
            if (turns.first(String(api.conversationId), turn)) {
              try { design = await control(socket, { kind: "design" }); }
              catch (error) { turns.forget(String(api.conversationId)); throw error; }
            }
          }
          return {
            output: [
              {
                type: "text",
                text: JSON.stringify(design === undefined ? result : { result, design }),
              },
            ],
          };
        },
      }),
    ],
  });
}
