import type { ReactNode } from "react";
import { ProgressRow } from "./progress-row";

export function AssistantHead({
  name = "Gaia",
  avatar = <span className="gaia-mark" />,
  active = false,
}: {
  name?: string;
  avatar?: ReactNode;
  active?: boolean;
}) {
  return (
    <div className="assistant-head" aria-hidden="true">
      {avatar}
      <span className="assistant-name">{name}</span>
      {active && <ProgressRow active avatar={null} />}
    </div>
  );
}
