import { NativeProcessFailure } from "./process.ts";

export class DesktopLease {
  private tail: Promise<void> = Promise.resolve();
  private failure: NativeProcessFailure | undefined;
  async use<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    if (this.failure) throw this.failure;
    signal.throwIfAborted();
    const previous = this.tail;
    let release = () => {};
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tail = previous.then(() => done);
    let abort = () => {};
    try {
      await Promise.race([
        previous,
        new Promise<never>((_, reject) => {
          abort = () => reject(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        }),
      ]);
      signal.throwIfAborted();
      if (this.failure) throw this.failure;
      return await action();
    } catch (error) {
      if (
        error instanceof NativeProcessFailure &&
        error.lifetime === "unjoined"
      )
        this.failure = error;
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      void previous.then(release);
    }
  }
}
