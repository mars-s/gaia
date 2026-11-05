import type { ReactNode } from "react";

export function EmptyChat({
  text = "What’s on your mind?",
  avatar = <span className="gaia-mark" />,
}: {
  text?: string;
  avatar?: ReactNode;
}) {
  return (
    <div className="empty-chat">
      <div className="empty-composition">
        {avatar}
        <h1 className="text-hero">{text}</h1>
      </div>
    </div>
  );
}
