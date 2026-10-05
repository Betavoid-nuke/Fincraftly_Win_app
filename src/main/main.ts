// =============================================================================
// src/main/main.ts
// -----------------------------------------------------------------------------
// Process entry point. Enforces a single running instance, registers the
// `raclink://` deep-link scheme, creates the one shell window and wires the
// app lifecycle. Everything window-shaped lives in shellWindow.ts.
// =============================================================================

import { app, Menu, Notification } from "electron";
import log from "electron-log/main";
import { browserLikeUserAgent } from "./platformSession";
import { ShellWindow } from "./shellWindow";
import { startAutoUpdates } from "./updater";
import { registerFinCodesBridge } from "./fincodes/bridge";
import { finCodes } from "./fincodes/host";
import { FinCodesTray } from "./fincodes/tray";
import { ensureTerminalCommand } from "./fincodes/terminal";

const PROTOCOL = "raclink";

log.initialize();
log.transports.file.level = "info";
log.transports.console.level = process.env.RACLINK_DEV === "1" ? "debug" : false;
log.errorHandler.startCatching();

// One instance: a second launch (double-clicking the shortcut, a deep link)
// focuses the existing window instead of opening another.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  bootstrap();
}

let shellWindow: ShellWindow | null = null;
let tray: FinCodesTray | null = null;
/** True once the person chose Quit (tray) — closing the window then really exits. */
let quitting = false;
let toldAboutTray = false;

function deepLinkFromArgv(argv: string[]): string | null {
  return argv.find((arg) => arg.toLowerCase().startsWith(`${PROTOCOL}://`)) ?? null;
}

function bootstrap(): void {
  app.setAppUserModelId("com.raclink.desktop");
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
    startFinCodes();
  }).catch((error) => {
    log.error("startup failed", error);
    app.quit();
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => { quitting = true; });
}

/**
 * FinCodes — AI employees coding on this computer. The app ships the program,
 * starts it, answers the department page's three requests (bridge.ts) and keeps a tray
 * icon. Once this computer is connected, closing the window hides it to the
 * tray and the app starts with Windows, so jobs started from the phone or the
 * web still reach this computer.
 */
function startFinCodes(): void {
  const window = shellWindow;
  if (!window) return;
  if (!finCodes.available()) { log.warn("fincodes: not bundled in this build"); return; }

  void ensureTerminalCommand();
  registerFinCodesBridge({
    platformContents: () => window.platformContents(),
    window: () => window.window,
    focus: () => window.focus(),
    changed: () => { void tray?.refresh(); void syncStartWithWindows(); },
  });

  if (process.env.RACLINK_SMOKE_FINCODES === "1" && !app.isPackaged) {
    void import("./fincodesSmoke").then(({ runFinCodesSmoke }) => runFinCodesSmoke(window.platformContents()));
  }

  void finCodes.ensureRunning().then((running) => {
    if (!running) return;
    tray = new FinCodesTray({
      show: () => window.focus(),
      openPath: (path) => window.openPlatformPath(path),
      quit: () => { quitting = true; app.quit(); },
    });
    void syncStartWithWindows();
  });

  window.window.on("close", (event) => {
    if (quitting || !tray?.connected) return;
    event.preventDefault();
    window.window.hide();
    if (!toldAboutTray && Notification.isSupported()) {
      toldAboutTray = true;
      new Notification({ title: "RacLink is still running", body: "Your AI employees can keep working on this computer. Quit from the tray icon." }).show();
    }
    void syncStartWithWindows();
  });
}

/** Start with Windows (to the tray) while this computer is connected to FinCodes; not otherwise. */
async function syncStartWithWindows(): Promise<void> {
  if (!app.isPackaged || process.platform !== "win32") return;
  const status = await finCodes.status().catch(() => null);
  const wanted = !!status?.paired;
  const current = app.getLoginItemSettings({ args: ["--hidden"] }).openAtLogin;
  if (wanted !== current) {
    app.setLoginItemSettings({ openAtLogin: wanted, args: ["--hidden"] });
    log.info(`start with Windows: ${wanted ? "on" : "off"}`);
  }
}
