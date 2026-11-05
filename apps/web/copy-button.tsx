import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  Children,
  isValidElement,
} from "react";

export function codeText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number")
        return String(child);
      return isValidElement<{ children?: ReactNode }>(child)
        ? codeText(child.props.children)
        : "";
    })
    .join("");
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className="copy-action"
      aria-label={label}
      onClick={async () => {
        clearTimeout(timer.current);
        try {
          await navigator.clipboard.writeText(text);
          setStatus("Copied");
        } catch {
          setStatus("Copy failed. Try again.");
        }
        timer.current = setTimeout(() => setStatus(""), 2000);
      }}
    >
      <span aria-live="polite">{status || "Copy"}</span>
    </button>
  );
}
