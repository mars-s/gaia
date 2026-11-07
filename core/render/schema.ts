import { z } from "zod";
const target = { role: z.enum(["button", "textbox", "option", "link", "tab", "checkbox", "menuitem", "heading", "combobox"]), name: z.string().min(1).max(160) };
export const Surface = z.object({ name: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), steps: z.array(z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), ...target }).strict(),
  z.object({ kind: z.literal("type"), ...target, text: z.string().max(1000) }).strict(),
  z.object({ kind: z.literal("wait"), ...target }).strict(),
  z.object({ kind: z.literal("press"), key: z.enum(["Escape", "Enter", "Tab", "Space", "ArrowDown", "ArrowUp"]) }).strict(),
])).max(8) }).strict();
export const Surfaces = z.array(Surface).max(6).refine(items => new Set(items.map(item => item.name)).size === items.length, "Surface names must be unique");
export type Surface = z.infer<typeof Surface>;
