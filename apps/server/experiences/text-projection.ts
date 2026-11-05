export function textProjection(
  write: (text: string) => Promise<unknown>,
  onError: (error: unknown) => void,
) {
  let pending: string | undefined;
  let previous: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let progress = Promise.resolve();
  let lastWrite = -Infinity;
  let closed = false;
  let failed = false;
  const enqueue = () => {
    const text = pending;
    pending = undefined;
    if (text === undefined || text === previous || failed) return;
    previous = text;
    lastWrite = Date.now();
    progress = progress
      .then(async () => {
        if (!failed) await write(text);
      })
      .catch((error: unknown) => {
        failed = true;
        onError(error);
      });
  };
  return {
    update(text: string) {
      if (closed || failed) return;
      pending = text;
      if (timer) return;
      const remaining = 250 - (Date.now() - lastWrite);
      if (remaining <= 0) enqueue();
      else
        timer = setTimeout(() => {
          timer = undefined;
          enqueue();
        }, remaining);
    },
    async finish() {
      closed = true;
      clearTimeout(timer);
      timer = undefined;
      enqueue();
      await progress;
    },
  };
}
