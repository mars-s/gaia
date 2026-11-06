import type { ReactNode } from "react";

export const starters = ["Help me plan my week", "Give me separate Bots for home, study and work", "What can you do on this machine?"] as const;

export function EmptyChat({
  text = "What’s on your mind?",
  onStarter,
  avatar = <span className="gaia-mark" />,
}: {
  text?: string;
  onStarter?: (text: string) => void;
  avatar?: ReactNode;
}) {
  return (
    <div className="empty-chat">
      <div className="empty-composition">
        {avatar}
        <h1 className="text-hero">{text}</h1>
        {onStarter && <ul className="starter-list" aria-label="Suggestions">{starters.map(text => <li key={text}><button className="starter" onClick={() => onStarter(text)}>{text}</button></li>)}</ul>}
      </div>
    </div>
  );
}
