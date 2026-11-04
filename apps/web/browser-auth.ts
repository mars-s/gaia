import type { Connection } from "../../packages/protocol/index.ts";

export async function openAuthInBrowser(url: string): Promise<void> {
  if (window.gaiaDesktop) {
    await window.gaiaDesktop.openAuth(url);
    return;
  }
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password) {
    throw new Error("The sign-in address is invalid. Try connecting again.");
  }
  // Keep the returned handle so blocked popups can offer an explicit retry.
  const tab = window.open("about:blank", "_blank");
  if (!tab) throw new Error("Select Open browser to continue signing in.");
  tab.opener = null;
  tab.location.href = target.href;
}

export function createAuthBrowserFlow(open: (url: string) => Promise<void>) {
  const opened = new Set<string>();
  return async (connection: Connection): Promise<void> => {
    if (connection.kind !== "connecting") {
      opened.clear();
      return;
    }
    if (!connection.url || opened.has(connection.url)) return;
    // Mark before awaiting: SSE replays and StrictMode must not open more tabs.
    opened.add(connection.url);
    await open(connection.url);
  };
}
