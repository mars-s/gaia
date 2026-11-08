import { parseArgs } from "node:util";
import { z } from "zod";
import { broker } from "./broker.ts";
const { values } = parseArgs({ options: {
  "owner-data": { type: "string" }, data: { type: "string" }, provider: { type: "string" },
  port: { type: "string" }, hours: { type: "string", default: "4" },
} });
try {
  process.exitCode = await broker({ ownerData: values["owner-data"] ?? "", data: values.data ?? "", provider: z.enum(["openai-codex", "anthropic"]).parse(values.provider), port: Number(values.port), hours: Number(values.hours) });
} catch (error) {
  const message = error instanceof Error && error.message === "That plan is not signed in on your Gaia."
    ? error.message : "Plan lease could not start. Check the arguments and stop the owner runtime first.";
  process.stderr.write(message + "\n");
  process.exitCode = 1;
}
