#!/usr/bin/env node
// =============================================================================
// scripts/sign-release.mjs
// -----------------------------------------------------------------------------
// Signs the auto-update feed so a compromise of the update HOST cannot ship code
// to customers (security audit finding #4, 2026-09-06).
//
// WHY
//   electron-updater checks the installer's SHA-512 against latest.yml — and
//   latest.yml is served by the same host as the installer. That proves nothing
//   about WHO published it. This script produces a detached Ed25519 signature
//   over latest.yml using a private key that lives only in the release pipeline;
//   the app verifies it against a public key compiled into the binary
//   (src/main/updateIntegrity.ts). An attacker who owns the update host can
//   serve whatever they like and still cannot make a client install it.
//
// USAGE
//   1. Once, to create the key pair:
//        node scripts/sign-release.mjs --generate-keys
//      • Paste the PUBLIC key into RELEASE_PUBLIC_KEY in src/main/updateIntegrity.ts
//        and commit that. Rebuild so shipped clients carry it.
//      • Put the PRIVATE key in the release pipeline's secret store as
//        DESKTOP_RELEASE_PRIVATE_KEY. Never commit it, never put it on the web
//        host, never put it in .env.local — the whole point is that it is NOT
//        anywhere the update host can reach.
//
//   2. On every release, after `npm run dist`:
//        DESKTOP_RELEASE_PRIVATE_KEY="$(cat key.pem)" node scripts/sign-release.mjs
//      Writes release/latest.yml.sig. Upload it ALONGSIDE latest.yml and the
//      installer — a feed without it will be refused by signed-enabled clients.
//
// NOTE ON ROLLOUT ORDER (important)
//   Publish signatures BEFORE you bake the public key into a shipped build.
//   Clients that already carry the key refuse an unsigned feed, so signing must
//   already be part of the release process by the time such a client exists.
// =============================================================================

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const RELEASE_DIR = path.resolve(process.cwd(), "release");
const FEED_FILE = path.join(RELEASE_DIR, "latest.yml");
const SIG_FILE = path.join(RELEASE_DIR, "latest.yml.sig");

function generateKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  console.log("\n=== RELEASE PUBLIC KEY — paste into src/main/updateIntegrity.ts ===\n");
  console.log(JSON.stringify(publicPem));
  console.log("\n(assign it to RELEASE_PUBLIC_KEY, commit, and rebuild)\n");
  console.log("=== RELEASE PRIVATE KEY — store as DESKTOP_RELEASE_PRIVATE_KEY ===");
  console.log("Put this in the release pipeline's secret store ONLY.");
  console.log("Do NOT commit it. Do NOT place it on the update host. Do NOT put it in .env.local.\n");
  console.log(privatePem);
}

function sign() {
  const privatePem = process.env.DESKTOP_RELEASE_PRIVATE_KEY;
  if (!privatePem) {
    console.error(
      "DESKTOP_RELEASE_PRIVATE_KEY is not set.\n" +
      "Run `node scripts/sign-release.mjs --generate-keys` once, then provide the private key\n" +
      "from the release pipeline's secret store when signing.",
    );
    process.exit(1);
  }
  if (!fs.existsSync(FEED_FILE)) {
    console.error(`No ${FEED_FILE}. Run \`npm run dist\` first.`);
    process.exit(1);
  }

  const feed = fs.readFileSync(FEED_FILE);
  const signature = crypto.sign(null, feed, crypto.createPrivateKey(privatePem));
  fs.writeFileSync(SIG_FILE, signature.toString("base64"), "utf8");

  console.log(`Signed ${path.basename(FEED_FILE)} → ${path.basename(SIG_FILE)}`);
  console.log("Upload latest.yml, latest.yml.sig, the installer and its .blockmap together.");
}

if (process.argv.includes("--generate-keys")) generateKeys();
else sign();
