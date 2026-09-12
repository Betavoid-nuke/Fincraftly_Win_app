// =============================================================================
// src/preload/platformPreload.ts
// -----------------------------------------------------------------------------
// Runs in the platform page (fincraftly.com) with context isolation ON and the
// renderer SANDBOX ON — it is the only code that runs beside remote content, so
// it gets the strictest settings and imports nothing from the app (a sandboxed
// preload cannot `require` local modules; the two channel names below are
// mirrored in src/shared/config.ts → IPC.platformTheme / IPC.platformReady).
//
// It has exactly two jobs:
//   1. tell the shell which theme the platform is in, so the titlebar and the
//      Windows caption buttons repaint in step with `<html data-theme>`;
//   2. expose a tiny, read-only `window.fincraftlyDesktop` marker so the
//      platform can detect the desktop app in future without knowing Electron.
//
// It deliberately exposes NO way for page scripts to reach Node or IPC.
// =============================================================================

import { contextBridge, ipcRenderer } from "electron";

const CHANNEL_THEME = "platform:theme";
const CHANNEL_READY = "platform:ready";

/**
 * The platform's own theme key (lib/theme/themeConfig.ts → LS_THEME). The
 * desktop app is dark by default: on a fresh session, before the platform's
 * first paint, seed the key so the page never starts light. A theme the
 * person has chosen explicitly (here or on the web, synced through their
 * account settings) still wins — this only fills the blank.
 */
const PLATFORM_THEME_KEY = "finos.theme";

try {
  if (window.location.protocol.startsWith("http") && !window.localStorage.getItem(PLATFORM_THEME_KEY)) {
    window.localStorage.setItem(PLATFORM_THEME_KEY, "dark");
  }
} catch {
  // Storage can be unavailable (file: pages); the platform then uses its own default.
}

type ShellTheme = "dark" | "light";

/**
 * Only the signed-in platform declares its theme (`<html data-theme>`, set by
 * lib/theme/ThemeProvider). Pages without it — sign-in, marketing, errors —
 * report nothing, so they can never flip the shell to a theme the person
 * never chose (v1.0 learned this the hard way: the Clerk sign-in page, which
 * carries no attribute, was being read as "light" and persisted).
 */
function currentTheme(): ShellTheme | null {
  const declared = document.documentElement.getAttribute("data-theme");
  return declared === "light" || declared === "dark" ? declared : null;
}

let lastReported: ShellTheme | null = null;

function reportTheme(): void {
  const theme = currentTheme();
  if (theme === null || theme === lastReported) return;
  lastReported = theme;
  ipcRenderer.send(CHANNEL_THEME, theme);
}

function watchTheme(): void {
  reportTheme();
  const observer = new MutationObserver(reportTheme);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

if (document.documentElement) {
  watchTheme();
} else {
  document.addEventListener("DOMContentLoaded", watchTheme, { once: true });
}

contextBridge.exposeInMainWorld("fincraftlyDesktop", {
  version: process.argv.find((arg) => arg.startsWith("--fincraftly-version="))?.slice("--fincraftly-version=".length) ?? "",
  platform: "windows",
});

ipcRenderer.send(CHANNEL_READY);
