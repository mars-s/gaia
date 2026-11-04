import {
  defineExtension,
  defineTool,
  section,
} from "@earendil-works/pi-durable";
import { z } from "zod";
import { Command } from "./state.ts";
import { control } from "./control-client.ts";
export function selfChangeTools(socket: string) {
  return defineExtension({
    name: "gaia-self-change",
    sections: [
      section(
        "gaia-self-change",
        () =>
          "You are Gaia, using Sol 6.1. For a requested UI or app change, use self_change to read source, stage complete replacement text with a reason, inspect the returned diff, then submit its id. Edits are real source changes in an owned worktree. Submit queues checks and deployment after this reply finishes. Never claim the change is live until history says accepted. Use status and history to inspect results. No shell or arbitrary filesystem tool is available.",
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
                'JSON command. Examples: {"kind":"read","path":"apps/web/main.tsx"}, {"kind":"stage","reason":"Add a heading","edits":[{"path":"apps/web/main.tsx","text":"complete file text"}]}, {"kind":"submit","id":"UUID"}, {"kind":"history"}, {"kind":"status"}, {"kind":"revert","id":"UUID"}.',
            },
          },
          required: ["command"],
          additionalProperties: false,
        },
        async execute(args) {
          const input = Command.parse(
            JSON.parse(z.object({ command: z.string() }).parse(args).command),
          );
          return {
            output: [
              {
                type: "text",
                text: JSON.stringify(await control(socket, input)),
              },
            ],
          };
        },
      }),
    ],
  });
}
