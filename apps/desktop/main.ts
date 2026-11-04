import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
} from "electron";
import { fileURLToPath } from "node:url";
import { authURL, externalWebURL, rendererURL } from "./urls.js";

app.setName("Gaia");
const target = rendererURL(
  process.env.GAIA_DESKTOP_URL ?? "http://127.0.0.1:4317",
);

function colours() {
  return nativeTheme.shouldUseDarkColors
    ? { color: "#121212", symbolColor: "#fafafa" }
    : { color: "#ffffff", symbolColor: "#171717" };
}

function isRenderer(url: string) {
  try {
    return new URL(url).origin === target.origin;
  } catch {
    return false;
  }
}

async function openWebLink(url: string) {
  try {
    await shell.openExternal(externalWebURL(url).href);
  } catch {
    console.warn("Gaia could not open the external web address.");
  }
}

async function createWindow() {
  const window = new BrowserWindow({
    title: "Gaia",
    width: 1000,
    height: 760,
    minWidth: 320,
    minHeight: 400,
    show: false,
    backgroundColor: colours().color,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition: { x: 16, y: 19 },
    ...(process.platform === "darwin"
      ? {}
      : { titleBarOverlay: { ...colours(), height: 52 } }),
    autoHideMenuBar: true,
    webPreferences: {
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openWebLink(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isRenderer(url)) return;
    event.preventDefault();
    void openWebLink(url);
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (!isRenderer(url)) event.preventDefault();
  });
  window.webContents.on("page-title-updated", (event) =>
    event.preventDefault(),
  );

  const syncTheme = () => {
    window.setBackgroundColor(colours().color);
    if (process.platform !== "darwin")
      window.setTitleBarOverlay({ ...colours(), height: 52 });
  };
  nativeTheme.on("updated", syncTheme);
  window.once("closed", () => nativeTheme.removeListener("updated", syncTheme));
  window.once("ready-to-show", () => window.show());

  await window.loadURL(target.href);
}

await app.whenReady();
ipcMain.handle("gaia:open-auth", async (event, value: unknown) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (
    !owner ||
    event.senderFrame !== owner.webContents.mainFrame ||
    !isRenderer(event.senderFrame.url)
  ) {
    throw new Error("Sign-in may only be opened by Gaia's main window.");
  }
  await shell.openExternal(authURL(value));
});

async function launch() {
  try {
    await createWindow();
  } catch {
    dialog.showErrorBox(
      "Gaia could not open",
      "Start the Gaia server and web client, then reopen the desktop app. Check GAIA_DESKTOP_URL if you use a different address.",
    );
    app.quit();
  }
}

await launch();
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void launch();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
