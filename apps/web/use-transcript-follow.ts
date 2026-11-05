import { useEffect, type RefObject } from "react";

/** Keep a followed conversation clear when cards, images or the composer resize. */
export function useTranscriptFollow(
  bottom: RefObject<HTMLDivElement | null>,
  follow: RefObject<boolean>,
  enabled = true,
) {
  useEffect(() => {
    const content = bottom.current?.parentElement;
    const viewport = content?.parentElement;
    if (!enabled || !content || !viewport) return;
    const observer = new ResizeObserver(() => {
      if (follow.current) bottom.current?.scrollIntoView({ block: "end" });
    });
    observer.observe(content);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [bottom, follow, enabled]);
}
