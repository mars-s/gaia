import type { ManagedChange } from "../../packages/sdk/managed.ts";
import type { ChangeSource } from "../../packages/protocol/change-preview.ts";

export function changesForReply(changes: ManagedChange[], source: ChangeSource) {
  return changes.filter(change => change.source?.kind === source.kind && change.source.answerMessageId === source.answerMessageId && (source.kind === "original" || (change.source.kind === "experience" && change.source.profileId === source.profileId && change.source.scopeId === source.scopeId)) && !["Replaced by a revised proposal.", "Staged draft discarded."].includes(change.detail));
}

