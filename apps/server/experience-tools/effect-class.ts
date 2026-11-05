import { defineTool, type Extension } from "@earendil-works/pi-durable";

type Tool = NonNullable<Extension["tools"]>[number];
type EffectClass = "read" | "effect";
const classes = new WeakMap<Tool, EffectClass>();

// Only trusted host registration sets this metadata. Tool inputs cannot set it.
export function defineClassifiedTool(
  effectClass: EffectClass,
  definition: Parameters<typeof defineTool>[0],
) {
  const tool = defineTool(definition);
  classes.set(tool, effectClass);
  return tool;
}

export function effectClassOf(tool: Tool): EffectClass {
  return classes.get(tool) ?? "effect";
}
