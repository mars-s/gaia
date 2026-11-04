import { z } from "zod";
import { Chat, Thread } from "../protocol/index.ts";
import { AreaId } from "./workspace.ts";

export const AreaSnapshot = z.strictObject({
  areaId: AreaId,
  thread: Thread,
  chat: Chat,
});
export type AreaSnapshot = z.infer<typeof AreaSnapshot>;
