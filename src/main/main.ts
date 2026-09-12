// =============================================================================
// src/main/main.ts
// -----------------------------------------------------------------------------
// Process entry point. Enforces a single running instance, registers the
// `fincraftly://` deep-link scheme, creates the one shell window and wires the
// app lifecycle. Everything window-shaped lives in shellWindow.ts.
// =============================================================================

import { app, Menu } from "electron";
import log from "electron-log/main";
import { browserLikeUserAgent } from "./platformSession";
import { ShellWindow } from "./shellWindow";
import { startAutoUpdates } from "./updater";

const PROTOCOL = "fincraftly";

log.initialize();
log.transports.file.level = "info";
log.transports.console.level = process.env.FINCRAFTLY_DEV === "1" ? "debug" : false;
log.errorHandler.startCatching();

// One instance: a second launch (double-clicking the shortcut, a deep link)
// focuses the existing window instead of opening another.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  bootstrap();
}

let shellWindow: ShellWindow | null = null;

function deepLinkFromArgv(argv: string[]): string | null {
  return argv.find((arg) => arg.toLowerCase().startsWith(`${PROTOCOL}://`)) ?? null;
}

function bootstrap(): void {
  app.setAppUserModelId("com.fincraftly.desktop");
  // Every renderer, on every session, identifies as plain Chrome: identity
  // providers refuse user agents that carry an "Electron" or app-name token.
  app.userAgentFallback = browserLikeUserAgent(app.userAgentFallback);
  if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL);

  // No native menu bar: the titlebar strip is the whole chrome.
  Menu.setApplicationMenu(null);

  app.on("second-instance", (_event, argv) => {
    log.info("second instance", argv.map((arg) => arg.replace(/ticket=[^&]+/, "ticket=…")).join(" "));
    if (!shellWindow) return;
    const link = deepLinkFromArgv(argv);
    if (link) shellWindow.openDeepLink(link);
    else shellWindow.focus();
  });

  // Renderer hardening defaults for anything that might ever be created.
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
    // Default for every page, including sign-in popups: no further windows.
    // ShellWindow installs its own, more permissive handler on the platform view.
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
  });

  app.whenReady().then(() => {
    shellWindow = new ShellWindow();
    const link = deepLinkFromArgv(process.argv);
    if (link) shellWindow.openDeepLink(link);
    startAutoUpdates();
  }).catch((error) => {
    log.error("startup failed", error);
    app.quit();
  });

  app.on("window-all-closed", () => app.quit());
}
