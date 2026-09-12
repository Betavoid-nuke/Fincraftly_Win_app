// =============================================================================
// src/main/updater.ts
// -----------------------------------------------------------------------------
// Silent background updates via electron-updater. Active only in a packaged
// build that ships an update feed (the `publish` block in electron-builder.yml
// writes `app-update.yml` into the package). Without a feed, or offline, it
// logs and stays quiet — the app must never nag or fail because of updates.
//
// ── SUPPLY-CHAIN HARDENING (security audit finding #4, 2026-09-06) ──────────
// The update feed and the installer are served by the SAME host as the web app
// (https://fincraftly.com/desktop/updates), and this app auto-downloads and
// auto-installs. electron-updater's SHA-512 check is computed from latest.yml on
// that same host, so it proves "I got what the host offered" — not "FinCraftly
// published this". Whoever can write to that path can ship code to every
// customer machine. Two independent checks close that, and this file wires both:
//
//   1. WINDOWS CODE SIGNING (the real fix; needs a certificate — see
//      SECURITY_RUNBOOK.md). electron-updater then verifies the publisher of the
//      downloaded installer against `win.publisherName`, which no web-host
//      compromise can forge. `verifyUpdateCodeSignature` is on in
//      electron-builder.yml, so this engages automatically once builds are signed.
//
//   2. A SIGNED UPDATE FEED (works today, no certificate needed). A detached
//      Ed25519 signature over latest.yml, verified against a public key compiled
//      into this app, with the private key held only by the release pipeline.
//      See updateIntegrity.ts. Inert — and behaviour-identical to before — until
//      a key is baked in, at which point an unsigned feed stops the update.
//
// Also set here: no downgrades and no pre-releases, so a rollback to a known-
// vulnerable version cannot be pushed as if it were an update.
// =============================================================================

import { app } from "electron";
import log from "electron-log/main";
import { verifyUpdateFeed, updateSigningEnabled } from "./updateIntegrity";

const FIRST_CHECK_DELAY_MS = 15_000;
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Must match `publish.url` in electron-builder.yml. Used only for the
 * independent feed-signature check; electron-updater reads its own copy from the
 * app-update.yml the packager writes.
 */
const UPDATE_FEED_URL = process.env.FINCRAFTLY_UPDATE_FEED || "https://fincraftly.com/desktop/updates";

export function startAutoUpdates(): void {
  if (!app.isPackaged || process.env.FINCRAFTLY_DEV === "1") return;

  // Loaded lazily so a missing feed file cannot affect startup.
  let autoUpdater: typeof import("electron-updater").autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater") as typeof import("electron-updater"));
  } catch (error) {
    log.warn("electron-updater unavailable", error);
    return;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // A "downgrade" offered by a compromised feed is how an attacker moves every
  // client back onto a version whose holes they already know. Never accept one,
  // and never accept a pre-release on the stable channel.
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("error", (error) => log.warn("auto-update", error?.message ?? error));
  autoUpdater.on("update-downloaded", (info) => log.info("update downloaded", info.version));

  const check = async () => {
    try {
      // INDEPENDENT INTEGRITY GATE. Nothing is downloaded until the feed proves
      // it came from FinCraftly's release key — when that key is configured.
      const verdict = await verifyUpdateFeed(UPDATE_FEED_URL);
      if (verdict.status === "rejected") {
        // Deliberately silent to the user and non-fatal to the app: an update
        // that cannot be trusted is simply not installed. It IS loud in the log,
        // which is where a real incident gets noticed.
        log.error(
          `[auto-update] REFUSED — the update feed failed its integrity check: ${verdict.reason}. ` +
          "No update was downloaded. If this is not a misconfiguration, treat the update host as compromised.",
        );
        return;
      }
      if (verdict.status === "unverified" && updateSigningEnabled()) {
        log.warn(`[auto-update] feed not verified: ${verdict.reason}`);
      }

      await autoUpdater.checkForUpdates();
    } catch (error: unknown) {
      log.warn("checkForUpdates", error);
    }
  };

  setTimeout(() => { void check(); }, FIRST_CHECK_DELAY_MS);
  setInterval(() => { void check(); }, RECHECK_INTERVAL_MS);
}
