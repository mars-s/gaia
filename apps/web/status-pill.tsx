import type { ReactNode } from "react";
export function StatusPill({ tone = "neutral", children }: { tone?: "neutral" | "accent"; children: ReactNode }) {
  return <span className="status-pill" data-tone={tone}>{children}</span>;
}
