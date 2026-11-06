import { RiChat1Line, RiGroupLine, RiLayoutColumnLine, RiChatHistoryLine } from "@remixicon/react";
import type { ExperienceLayout } from "../../packages/protocol/experiences";

const glyphs = {
  single: RiChat1Line,
  bots: RiGroupLine,
  channels: RiLayoutColumnLine,
  sessions: RiChatHistoryLine,
};

export function SetupGlyph({ layout }: { layout: ExperienceLayout }) {
  const Icon = glyphs[layout];
  return <Icon className="setup-layout-icon" aria-hidden="true" />;
}
