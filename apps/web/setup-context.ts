import type { ExperienceLayout } from "../../packages/protocol/experiences";

export const setupContext: Record<ExperienceLayout, { section: string; change: string }> = {
  single: { section: "Conversation", change: "One conversation with shared explicit memory." },
  bots: { section: "Bots · separate memory", change: "Each Bot keeps its own memory and conversation." },
  channels: { section: "Channels · shared memory", change: "Channels share remembered facts, with separate conversations." },
  sessions: { section: "Sessions · separate histories", change: "Sessions keep separate histories. New remembered facts are shared across sessions." },
};

export function sessionRecency(timestamp: string | undefined, now = new Date()): string | undefined {
  if (!timestamp) return undefined;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return undefined;
  if (date.toDateString() === now.toDateString()) return "today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "yesterday";
  return date.toLocaleDateString("en-AU", {
    day: "numeric", month: "short",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}
