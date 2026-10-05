// =============================================================================
// src/main/fincodes/bridge.ts
// -----------------------------------------------------------------------------
// What the platform page (a department's page, in this app only) may ask of
// FinCodes on this computer. Three requests:
//
//   fincodes:status          read-only: is FinCodes here, is it connected, which folders
//   fincodes:connect         pair this computer. SILENT (Jay, 2026-09-27): the consent page
//                            is loaded in a HIDDEN window in the app's own signed-in session
//                            with a header only this process can add, and approves itself.
//                            The person never sees a "connect this computer" step — attaching
//                            a folder is the act. The window is shown only if something fails.
//   fincodes:connect-folder  the person picks a folder in the Windows folder picker; risky
//                            folders and any profile above Guarded need a second, native "yes"
//
// The page never sends a path, a command or a key. Requests are accepted only
// from the platform view, on the platform origin, one flow at a time. See
// SECURITY.md → "FinCodes bridge".
// =============================================================================

import { BrowserWindow, dialog, ipcMain, Notification, shell, type BaseWindow, type IpcMainInvokeEvent, type WebContents } from "electron";
import log from "electron-log/main";
import { basename } from "node:path";
import { getPlatformSession } from "../platformSession";
import { isPlatformUrl, platformOrigin } from "../platformUrls";
import { finCodes } from "./host";

export const FINCODES_IPC = {
  status: "fincodes:status",
  connect: "fincodes:connect",
  connectFolder: "fincodes:connect-folder",
} as const;

const PROFILES = ["read-only", "guarded", "trusted", "autonomous"] as const;
type Profile = (typeof PROFILES)[number];

const PROFILE_WORDS: Record<Profile, string> = {
  "read-only": "read and run safe commands only — they never change anything",
  guarded: "every file change asks you first",
  trusted: "they change files WITHOUT asking you first; unknown commands still ask",
  autonomous: "they work on their own; only dangerous steps (push, delete, install, anything forced) ask",
};

interface GrantOutcome {
  ok: boolean;
  refused?: string;
  needsConfirmation?: boolean;
  warnings?: string[];
  grant?: { workspaceId: string; name: string; realPath: string; profile: Profile };
  clampedTo?: Profile;
}

export interface BridgeHost {
  /** The platform view's webContents — the only sender accepted. */
  platformContents(): WebContents;
  /** The window dialogs are attached to. */
  window(): BaseWindow;
  focus(): void;
  /** Something changed on this computer (paired, folder connected): refresh tray and login item. */
  changed(): void;
}

let busy = false;

/**
 * Only the signed-in platform (the /dashboard/… app, where a department’s page lives), in the platform
 * view's main frame. Not marketing pages, not shared artifacts, not a subframe.
 */
function trusted(event: IpcMainInvokeEvent, host: BridgeHost): boolean {
  const frameUrl = event.senderFrame?.url || "";
  if (event.sender !== host.platformContents() || event.senderFrame !== event.sender.mainFrame || !isPlatformUrl(frameUrl)) return false;
  try { return /^\/dashboard\/[^/]+\/[^/]+/.test(new URL(frameUrl).pathname); } catch { return false; }
}

/**
 * The header that lets the consent page approve itself. Added by THIS process to
 * ONE request it builds itself; a page in a browser cannot set it, so a link with
 * `auto=1` typed anywhere else still shows the ordinary Connect button.
 */
const DESKTOP_PAIR_HEADER = "x-raclink-desktop-pair";

/** The consent window may show the platform and the platform's own Clerk frontend (session handshake) — nothing else. */
function consentMayShow(url: string): boolean {
  if (isPlatformUrl(url)) return true;
  try {
    const target = new URL(url);
    const platformHost = new URL(platformOrigin()).hostname;
    return target.protocol === "https:" && (target.hostname === `clerk.${platformHost}` || target.hostname === `accounts.${platformHost}`);
  } catch { return false; }
}

async function once<T>(work: () => Promise<T>): Promise<T | { ok: false; reason: string }> {
  if (busy) return { ok: false, reason: "busy" };
  busy = true;
  try { return await work(); } finally { busy = false; }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function statusView() {
  const status = await finCodes.status();
  if (!status) return { available: finCodes.available(), running: false, paired: false, connection: "offline", machine: null, workspaces: [] };
  return {
    available: true,
    running: true,
    paired: status.paired,
    connection: status.connection,
    machine: status.machine ? { machineId: status.machine.machineId, name: status.machine.name, org: status.machine.org } : null,
    // Folder names, not paths: the page does not need where on disk (or whose user folder) a project lives.
    workspaces: status.workspaces.map((ws) => ({ workspaceId: ws.workspaceId, name: ws.name, profile: ws.profile })),
    working: status.sessions.filter((session) => session.status === "running").length,
    pendingApprovals: status.pendingApprovals,
  };
}

/**
 * Pair this computer. FinCodes starts the pairing and returns a one-time code;
 * the consent page for THAT code opens over the app in the app's own signed-in
 * session. Nothing is approved here — the person clicks Approve on the page.
 */
async function connect(host: BridgeHost, force: boolean): Promise<{ ok: boolean; reason?: string; machineId?: string }> {
  if (force) {
    // Re-pairing retires this computer's current connection (its jobs stop, its folders are released)
    // before the new one exists. That is the person's decision, taken here — never the page's alone.
    const state = await finCodes.call<{ paired: boolean; machine: { name: string; org: string } | null }>("pair/state");
    if (state.paired) {
      const answer = await dialog.showMessageBox(host.window(), {
        type: "warning",
        title: "RacLink",
        message: `Disconnect this computer from ${state.machine?.org || "its current workspace"}?`,
        detail: "Its jobs stop and its folders are released. You then approve the new connection on the page that opens, and connect folders again.",
        buttons: ["Cancel", "Disconnect and reconnect"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (answer.response !== 1) return { ok: false, reason: "cancelled" };
    }
  }
  const begun = await finCodes.call<{ paired: boolean; userCode?: string; expiresAt?: number; machine?: { name: string } }>("pair/begin", { force }, 30_000);
  if (begun.paired) {
    const state = await finCodes.call<{ machine: { machineId: string } | null }>("pair/state");
    return { ok: true, machineId: state.machine?.machineId };
  }
  const code = String(begun.userCode || "");
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return { ok: false, reason: "FinCodes did not return a pairing code." };
  // The consent URL is built HERE from the app's own origin — a URL from anywhere else is never loaded.
  // `auto=1` + the desktop header: the page submits its own Connect button for the org the app is
  // signed into, so pairing happens behind the folder picker instead of in front of it.
  const consentUrl = `${platformOrigin()}/fincodes/connect?code=${encodeURIComponent(code)}&auto=1`;

  const consent = new BrowserWindow({
    parent: host.window(),
    modal: true,
    show: false,
    width: 520,
    height: 720,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: `Connect this computer — code ${code}`,
    backgroundColor: "#121417",
    autoHideMenuBar: true,
    webPreferences: {
      session: getPlatformSession(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: false,
    },
  });
  // Shown only when the silent path cannot finish — a sign-in that lapsed, a
  // plan limit, a page that needs the person to pick a workspace.
  let shown = false;
  const reveal = () => { if (!shown && !consent.isDestroyed()) { shown = true; consent.show(); } };
  const revealTimer = setTimeout(reveal, 12_000);
  consent.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:/i.test(url) && !isPlatformUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  consent.webContents.on("will-navigate", (event, url) => { if (!consentMayShow(url)) event.preventDefault(); });
  consent.webContents.on("will-redirect", (event, url) => { if (!consentMayShow(url)) event.preventDefault(); });
  consent.webContents.on("page-title-updated", (event) => event.preventDefault());
  let closed = false;
  consent.on("closed", () => { closed = true; });
  await consent.loadURL(consentUrl, { extraHeaders: `${DESKTOP_PAIR_HEADER}: 1\r\n` }).catch((error) => { log.warn("fincodes consent load", error); reveal(); });

  const deadline = Math.min(Number(begun.expiresAt) || Date.now() + 10 * 60_000, Date.now() + 15 * 60_000);
  while (Date.now() < deadline) {
    await wait(1_000);
    const state = await finCodes.call<{ paired: boolean; error: string; machine: { machineId: string; name: string; org: string } | null }>("pair/state").catch(() => null);
    if (state?.paired) {
      clearTimeout(revealTimer);
      if (!closed) consent.close();
      host.focus();
      // Say, outside the page, which workspace this computer now works for.
      if (Notification.isSupported()) new Notification({ title: "This computer is connected", body: `FinCodes now works for ${state.machine?.org || "your workspace"} on this computer.` }).show();
      return { ok: true, machineId: state.machine?.machineId };
    }
    if (state?.error) {
      clearTimeout(revealTimer);
      if (!closed) consent.close();
      return { ok: false, reason: /denied/i.test(state.error) ? "denied" : state.error };
    }
    // Closing the window is "not now". The code expires on its own.
    if (closed) { clearTimeout(revealTimer); return { ok: false, reason: "cancelled" }; }
  }
  clearTimeout(revealTimer);
  if (!closed) consent.close();
  return { ok: false, reason: "The code expired. Try again." };
}

async function connectFolder(host: BridgeHost, profile: Profile) {
  const state = await finCodes.call<{ paired: boolean }>("pair/state");
  if (!state.paired) {
    const paired = await connect(host, false);
    if (!paired.ok) return paired;
  }

  const picked = await dialog.showOpenDialog(host.window(), {
    title: "Choose a project folder for your AI employees",
    buttonLabel: "Connect folder",
    properties: ["openDirectory", "createDirectory", "dontAddToRecent"],
  });
  if (picked.canceled || !picked.filePaths[0]) return { ok: false, reason: "cancelled" };
  const path = picked.filePaths[0];
  const name = basename(path) || path;

  // A profile that lets AI employees act without asking is a local, deliberate choice — say so natively.
  if (profile === "trusted" || profile === "autonomous") {
    const answer = await dialog.showMessageBox(host.window(), {
      type: "warning",
      title: "RacLink",
      message: `Let AI employees work in "${name}" as ${profile === "trusted" ? "Trusted" : "Autonomous"}?`,
      detail: `${path}\n\nIn this mode ${PROFILE_WORDS[profile]}. Pushing, deleting, installing and anything forced still always ask.`,
      buttons: ["Cancel", "Allow"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (answer.response !== 1) return { ok: false, reason: "cancelled" };
  }

  let outcome = await finCodes.call<GrantOutcome>("workspace/grant", { path, profile, confirmed: false }, 60_000);
  if (!outcome.ok && outcome.needsConfirmation) {
    const answer = await dialog.showMessageBox(host.window(), {
      type: "warning",
      title: "RacLink",
      message: `Connect "${name}" anyway?`,
      detail: `${path}\n\n${(outcome.warnings || []).map((warning) => `• ${warning}`).join("\n")}\n\nFiles holding secrets (.env, keys) are never read or sent, whatever you choose here.`,
      buttons: ["Cancel", "Connect anyway"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (answer.response !== 1) return { ok: false, reason: "cancelled" };
    outcome = await finCodes.call<GrantOutcome>("workspace/grant", { path, profile, confirmed: true }, 60_000);
  }
  if (!outcome.ok || !outcome.grant) {
    const reason = outcome.refused || "That folder cannot be connected.";
    await dialog.showMessageBox(host.window(), { type: "error", title: "RacLink", message: `"${name}" can't be connected`, detail: reason, buttons: ["OK"], noLink: true });
    return { ok: false, reason };
  }
  const machine = await finCodes.call<{ machine: { machineId: string } | null }>("pair/state");
  return {
    ok: true,
    workspaceId: outcome.grant.workspaceId,
    name: outcome.grant.name,
    profile: outcome.clampedTo || outcome.grant.profile,
    machineId: machine.machine?.machineId || "",
  };
}

export function registerFinCodesBridge(host: BridgeHost): void {
  ipcMain.handle(FINCODES_IPC.status, async (event) => {
    if (!trusted(event, host)) return { available: false };
    return await statusView();
  });

  ipcMain.handle(FINCODES_IPC.connect, async (event, input: unknown) => {
    if (!trusted(event, host)) return { ok: false, reason: "refused" };
    const force = !!(input && typeof input === "object" && (input as { force?: unknown }).force === true);
    return await once(() => connect(host, force)).then((out) => { host.changed(); return out; }).catch((error: unknown) => ({ ok: false, reason: error instanceof Error ? error.message : "failed" }));
  });

  ipcMain.handle(FINCODES_IPC.connectFolder, async (event, input: unknown) => {
    if (!trusted(event, host)) return { ok: false, reason: "refused" };
    const requested = input && typeof input === "object" ? (input as { profile?: unknown }).profile : undefined;
    const profile: Profile = PROFILES.includes(requested as Profile) ? requested as Profile : "guarded";
    return await once(() => connectFolder(host, profile)).then((out) => { host.changed(); return out; }).catch((error: unknown) => ({ ok: false, reason: error instanceof Error ? error.message : "failed" }));
  });
}
