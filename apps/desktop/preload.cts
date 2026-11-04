import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld(
  "gaiaDesktop",
  Object.freeze({
    platform: process.platform,
    openAuth: (url: string): Promise<void> =>
      ipcRenderer.invoke("gaia:open-auth", url),
  }),
);
