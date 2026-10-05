// =============================================================================
// src/main/fincodes/host.ts
// -----------------------------------------------------------------------------
// FinCodes inside the desktop app. The app ships the FinCodes program
// (resources/fincodes/fincodes.mjs + its pinned grammar files) and runs it with
// the app's OWN executable as Node (ELECTRON_RUN_AS_NODE=1) — so a customer
// installs one thing and never needs Node, npm or a terminal.
//
// The program runs DETACHED: it keeps working for the phone and the web while
// the window is closed, and it is the same process the `fincodes` terminal
// command talks to. The app only starts it, checks it is the version this app
// ships (restarting it after an update), and talks to it over the local pipe.
//
// FINCODES_HOST=app tells FinCodes not to install its own "start at login"
// task — the app itself starts with Windows (see main.ts).
// =============================================================================

import { app } from "electron";
import log from "electron-log/main";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PLATFORM_ORIGIN } from "../../shared/config";
import { platformOrigin } from "../platformUrls";
import { DaemonClient, DaemonError } from "./daemonClient";

export interface DaemonStatus {
  version: string;
  pid: number;
  connection: string;
  detail: string;
  paired: boolean;
  machine: { machineId: string; name: string; org: string; member: string } | null;
  sessions: Array<{ sessionId: string; jobId: string; status: string; aie: { name: string }; todo: string }>;
  pendingApprovals: number;
  workspaces: Array<{ workspaceId: string; name: string; path: string; profile: string }>;
}

/** Where the bundled FinCodes program lives: resources/fincodes when installed, vendor/fincodes in development. */
export function bundleDir(): string {
  return app.isPackaged ? join(process.resourcesPath, "fincodes") : join(app.getAppPath(), "vendor", "fincodes");
}

export function bundledVersion(): string {
  try { return readFileSync(join(bundleDir(), "VERSION"), "utf8").trim(); } catch { return ""; }
}

/** The environment FinCodes runs with when the app starts it (and that the terminal shim sets too). */
export function daemonEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1", FINCODES_HOST: "app", FINCODES_ENTRY: join(bundleDir(), "fincodes.mjs") };
  // Development builds point the app at another origin; FinCodes must follow it (an explicit
  // FINCODES_CLOUD wins in development only). An installed app always uses the live platform.
  if (app.isPackaged || !process.env.FINCODES_CLOUD) {
    if (platformOrigin() !== DEFAULT_PLATFORM_ORIGIN) env.FINCODES_CLOUD = platformOrigin();
    else delete env.FINCODES_CLOUD;
  }
  // The app's own Chromium/Electron switches mean nothing to a Node process.
  delete env.ELECTRON_ENABLE_LOGGING;
  return env;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class FinCodesHost {
  readonly client = new DaemonClient();
  private starting: Promise<boolean> | null = null;

  available(): boolean {
    return existsSync(join(bundleDir(), "fincodes.mjs"));
  }

  /**
   * The bundle lives outside the asar (it has to: the app runs it as Node), so before it is ever
   * started its hash is checked against the one baked INTO the app at build time.
   */
  private bundleIntact(): boolean {
    const expectedFile = join(__dirname, "bundle.sha256");
    if (!existsSync(expectedFile)) return !app.isPackaged; // development builds may run an unhashed bundle
    try {
      const expected = readFileSync(expectedFile, "utf8").trim();
      const actual = createHash("sha256").update(readFileSync(join(bundleDir(), "fincodes.mjs"))).digest("hex");
      return expected === actual;
    } catch { return false; }
  }

  /** Make sure the bundled FinCodes is running and reachable. Never throws; false = not available. */
  ensureRunning(): Promise<boolean> {
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async start(): Promise<boolean> {
    if (!this.available()) { log.warn("fincodes: bundle missing at", bundleDir()); return false; }
    const want = bundledVersion();
    try {
      await this.client.connect(1_500);
      const status = await this.client.call<DaemonStatus>("daemon/status");
      if (!want || status.version === want) return true;
      // An older FinCodes from before an app update: restart it on the version this app ships.
      // Sessions survive a restart (they resume from their journals).
      log.info(`fincodes: running ${status.version}, shipping ${want} — restarting it`);
      await this.client.call("daemon/stop").catch(() => null);
      this.client.close();
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await wait(250);
        try { await this.client.connect(500); this.client.close(); } catch { break; }
      }
    } catch (error) {
      if (!(error instanceof DaemonError)) log.warn("fincodes: status failed", error);
    }
    this.spawnDaemon();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await wait(250);
      try { await this.client.connect(750); return true; } catch { /* still starting */ }
    }
    log.error("fincodes: the program did not start (see ~/.fincodes/logs/fincodesd.log)");
    return false;
  }

  private spawnDaemon(): void {
    if (!this.bundleIntact()) { log.error("fincodes: the bundled program does not match this app's build — not starting it. Reinstall RacLink."); return; }
    const script = join(bundleDir(), "fincodes.mjs");
    const child = spawn(process.execPath, [script, "daemon", "run"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: daemonEnvironment(),
    });
    child.on("error", (error) => log.error("fincodes: spawn failed", error));
    child.unref();
    log.info(`fincodes: started ${bundledVersion() || "?"} (pid ${child.pid ?? "?"})`);
  }

  async status(): Promise<DaemonStatus | null> {
    if (!(await this.ensureRunning())) return null;
    try { return await this.client.call<DaemonStatus>("daemon/status"); } catch (error) { log.warn("fincodes: status", error); return null; }
  }

  async call<T>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    if (!(await this.ensureRunning())) throw new DaemonError("FinCodes could not start on this computer.");
    return await this.client.call<T>(method, params, timeoutMs);
  }
}

export const finCodes = new FinCodesHost();
