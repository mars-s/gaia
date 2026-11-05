import { HttpError } from "../http-error.ts";

export class Capacity {
  private active = new Map<number, number>();
  private queue: {
    depth: number;
    start: () => void;
    signal: AbortSignal;
    abort: () => void;
  }[] = [];
  constructor(private limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 16)
      throw new Error("Experience concurrency must be between 1 and 16.");
  }
  async acquire(depth: number, signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if ((this.active.get(depth) ?? 0) >= this.limit) {
      if (this.queue.length >= 256)
        throw new HttpError(503, "Work queue is full.");
      await new Promise<void>((resolve, reject) => {
        const entry = {
          depth,
          start: resolve,
          signal,
          abort: () => {
            this.queue = this.queue.filter((q) => q !== entry);
            reject(new Error("Work stopped."));
          },
        };
        this.queue.push(entry);
        signal.addEventListener("abort", entry.abort, { once: true });
      });
    } else this.active.set(depth, (this.active.get(depth) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const index = this.queue.findIndex((q) => q.depth === depth);
      if (index >= 0) {
        const [next] = this.queue.splice(index, 1);
        next.signal.removeEventListener("abort", next.abort);
        next.start();
      } else this.active.set(depth, (this.active.get(depth) ?? 1) - 1);
    };
  }
}
