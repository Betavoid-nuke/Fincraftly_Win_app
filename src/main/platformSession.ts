// =============================================================================
// src/main/platformSession.ts
// -----------------------------------------------------------------------------
// The persistent Chromium session the platform runs in: cookies survive
// restarts (so sign-in sticks), the user agent reads as plain Chrome, every
// request to the platform carries a desktop marker header, and web permissions
// are granted only to the platform origin. Sign-in itself never happens in
// this session — it happens in the person's browser (see shellWindow.ts).
// =============================================================================

import { app, session, type Session } from "electron";
import { DESKTOP_HEADER_NAME } from "../shared/config";
import { isPlatformUrl } from "./platformUrls";

const PARTITION = "persist:fincraftly";

/** Permissions the platform legitimately asks for; everything else is denied. */
const PLATFORM_PERMISSIONS: ReadonlySet<string> = new Set([
  "notifications",
  "media",            // microphone for voice features
  "clipboard-read",
  "clipboard-sanitized-write",
  "fullscreen",
  "display-capture",
]);

let platformSession: Session | null = null;

/** Browser-like user agent: Electron's own, minus the app and Electron tokens. */
export function browserLikeUserAgent(defaultUserAgent: string): string {
  return defaultUserAgent
    .replace(/\s?FinCraftly\/\S+/i, "")
    .replace(/\s?fincraftly-desktop\/\S+/i, "")
    .replace(/\s?Electron\/\S+/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function getPlatformSession(): Session {
  if (platformSession) return platformSession;

  const platformPartition = session.fromPartition(PARTITION);
  platformPartition.setUserAgent(browserLikeUserAgent(platformPartition.getUserAgent()));

  platformPartition.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;

    // Tag platform requests so the server can recognise the desktop client.
    if (isPlatformUrl(details.url)) {
      headers[DESKTOP_HEADER_NAME] = app.getVersion();
    }

    callback({ requestHeaders: headers });
  });

  platformPartition.setPermissionRequestHandler((webContents, permission, callback) => {
    const requestingUrl = webContents?.getURL() ?? "";
    callback(isPlatformUrl(requestingUrl) && PLATFORM_PERMISSIONS.has(permission));
  });
  platformPartition.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return isPlatformUrl(requestingOrigin) && PLATFORM_PERMISSIONS.has(permission);
  });

  platformSession = platformPartition;
  return platformPartition;
}

/** Wipes cookies and storage — used by "Sign out" so the next launch is clean. */
export async function clearPlatformSession(): Promise<void> {
  const current = getPlatformSession();
  await current.clearStorageData();
  await current.clearCache();
}
