// =============================================================================
// src/main/updateIntegrity.ts
// -----------------------------------------------------------------------------
// INDEPENDENT INTEGRITY CHECK FOR THE UPDATE FEED.
//
// THE PROBLEM (security audit finding #4, 2026-09-06)
//   electron-updater verifies the installer's SHA-512 against `latest.yml` — but
//   `latest.yml` is served by the SAME host as the installer, and today that host
//   is fincraftly.com, the live web app. So the integrity check answers "did I
//   download what the update host said?", not "did FinCraftly publish this?".
//   Anyone who can write to https://fincraftly.com/desktop/updates — a web-host
//   compromise, a mis-scoped storage container behind that path, a stolen deploy
//   credential — can publish a malicious latest.yml plus a matching installer,
//   and every desktop client auto-downloads and auto-installs it on next quit.
//   That is remote code execution on every customer machine.
//
//   Windows code signing is the standard second, independent check (the OS
//   verifies the publisher regardless of where the bytes came from). FinCraftly
//   does not have a certificate yet — see SECURITY_RUNBOOK.md for procurement.
//
// WHAT THIS DOES IN THE MEANTIME
//   A detached signature over `latest.yml`, verified against a public key
//   COMPILED INTO THE APP. The matching private key lives only in the release
//   pipeline — never on the web host. An attacker who owns the update host can
//   still serve files, but cannot produce a signature that verifies, so the
//   update is refused before a single byte of installer is downloaded.
//
//   This is deliberately independent of transport (HTTPS) and of the host: it is
//   the same model as apt/dnf repository signing, and it survives exactly the
//   compromise the audit describes.
//
// ── IT IS INERT UNTIL YOU TURN IT ON ────────────────────────────────────────
//   With no public key baked in, this module logs a loud warning and reports
//   'unverified', and the updater behaves EXACTLY as it does today — nothing
//   breaks, no release is blocked. Once RELEASE_PUBLIC_KEY below is populated
//   (see scripts/sign-release.mjs), verification becomes mandatory and an
//   unsigned or badly-signed feed stops the update.
//
//   Generate the key pair and wire the pipeline with:
//     node scripts/sign-release.mjs --generate-keys
// =============================================================================

import crypto from "crypto";
import log from "electron-log/main";

/**
 * The release-signing PUBLIC key, in SPKI PEM form (Ed25519).
 *
 * Paste the public key printed by `node scripts/sign-release.mjs --generate-keys`
 * here and rebuild. Keep the PRIVATE half in the release pipeline's secret store
 * ONLY — never in this repo, never on the web host, never in .env.local.
 *
 * Leave empty to keep verification disabled (today's behaviour).
 */
const RELEASE_PUBLIC_KEY = "";

/** How long to wait for the feed + signature before giving up. */
const FEED_TIMEOUT_MS = 10_000;

export type IntegrityVerdict =
  /** A signature was present and valid — the feed is authentic. */
  | { status: "verified" }
  /** No public key is configured, so nothing could be checked. Update proceeds. */
  | { status: "unverified"; reason: string }
  /** A key IS configured and the check FAILED. The update must not proceed. */
  | { status: "rejected"; reason: string };

/** True when release signing has been switched on for this build. */
export function updateSigningEnabled(): boolean {
  return RELEASE_PUBLIC_KEY.trim().length > 0;
}

/** Fetch a URL as text, with a hard timeout and a size cap. */
async function fetchText(url: string, maxBytes = 512 * 1024): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > maxBytes) throw new Error("feed too large");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify the update feed before electron-updater is allowed to act on it.
 *
 * @param feedBaseUrl The `publish.url` from electron-builder.yml, e.g.
 *                    https://fincraftly.com/desktop/updates
 */
export async function verifyUpdateFeed(feedBaseUrl: string): Promise<IntegrityVerdict> {
  if (!updateSigningEnabled()) {
    // Loud, once per check, so this never becomes invisible: an unsigned build
    // pulling from an unsigned feed is a known, accepted, temporary risk.
    log.warn(
      "[update-integrity] Release signing is NOT enabled: the update feed is trusted purely because " +
      "of where it is hosted. A compromise of the update host would be able to ship code to every " +
      "client. Enable it (scripts/sign-release.mjs --generate-keys) or ship a code-signed build.",
    );
    return { status: "unverified", reason: "no public key compiled into this build" };
  }

  const base = feedBaseUrl.replace(/\/+$/, "");
  let feed: string;
  let signature: string;

  try {
    feed = await fetchText(`${base}/latest.yml`);
  } catch (error) {
    // No feed at all is the normal "no update published yet" case, not an attack.
    return { status: "unverified", reason: `feed unavailable: ${(error as Error)?.message ?? error}` };
  }

  try {
    signature = await fetchText(`${base}/latest.yml.sig`, 8 * 1024);
  } catch (error) {
    // A feed WITHOUT a signature, on a build that requires one, is exactly the
    // attack this exists to stop. Refuse.
    return {
      status: "rejected",
      reason: `update feed has no signature (latest.yml.sig): ${(error as Error)?.message ?? error}`,
    };
  }

  try {
    const ok = crypto.verify(
      null, // Ed25519 uses no separate digest
      Buffer.from(feed, "utf8"),
      crypto.createPublicKey(RELEASE_PUBLIC_KEY),
      Buffer.from(signature.trim(), "base64"),
    );
    if (!ok) {
      return { status: "rejected", reason: "update feed signature did not verify against the pinned release key" };
    }
    return { status: "verified" };
  } catch (error) {
    return { status: "rejected", reason: `signature check errored: ${(error as Error)?.message ?? error}` };
  }
}
