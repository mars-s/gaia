const draftKey = "gaia.unsent-draft.v1";
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createDraftStore(storage: () => DraftStorage) {
  let draft = "";
  try {
    draft = storage().getItem(draftKey) ?? "";
  } catch {
    // The in-memory draft remains usable when browser storage is blocked.
  }
  function save(value: string) {
    draft = value;
    try {
      if (draft) storage().setItem(draftKey, draft);
      else storage().removeItem(draftKey);
      return true;
    } catch {
      return false;
    }
  }
  return {
    read: () => draft,
    save,
    completeSend(sent: string) {
      if (draft === sent) save("");
      return draft;
    },
    prepareReload: () => save(draft) || draft === "",
  };
}

export function loadedRelease(moduleUrl: string) {
  return /^\/_gaia\/releases\/([a-f0-9]{40})\/assets\//.exec(
    new URL(moduleUrl).pathname,
  )?.[1];
}

export function createReleaseObserver(
  prepare: () => boolean,
  reload: () => void,
  loadedRelease?: string,
) {
  let reloading = false;
  return (release: string | undefined) => {
    if (!release || reloading) return false;
    if (loadedRelease === release) return false;
    if (!prepare()) return true;
    reloading = true;
    reload();
    return false;
  };
}
