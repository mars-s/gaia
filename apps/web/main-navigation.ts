export function createMainRestore() {
  let restored = false;
  return function start(
    restore: (canNavigate: () => boolean) => Promise<boolean>,
    canNavigate: () => boolean,
    onOpen: () => void,
  ) {
    if (restored) return () => {};
    restored = true;
    let active = true;
    let settled = false;
    const allowed = () => active && canNavigate();
    void restore(allowed).then((opened) => {
      settled = true;
      if (opened && allowed()) onOpen();
    });
    return () => {
      active = false;
      if (!settled && canNavigate()) restored = false;
    };
  };
}

export function createNavigationGuard(read: () => unknown) {
  let revision = 0;
  return {
    moved() {
      revision++;
    },
    capture() {
      const token = revision;
      const snapshot = read();
      return () => token === revision && snapshot === read();
    },
  };
}
