// =============================================================================
// src/main/fincodesSmoke.ts
// -----------------------------------------------------------------------------
// Scripted check of FinCodes inside the app, run with FINCRAFTLY_SMOKE_FINCODES=1
// in a development build against a local platform (FINCRAFTLY_ORIGIN). Never
// active in a packaged build. Results are logged as "SMOKE-FC …" lines.
//
//   1. the bundled FinCodes starts under the app's own executable (as Node)
//   2. a platform page reaches the bridge (window.fincraftlyDesktop.fincodes)
//      and a non-platform page does not
//   3. the daemon-run pairing hands out a code (the harness approves it)
//   4. a folder is granted (FINCRAFTLY_SMOKE_FOLDER) — the same call the
//      folder picker path makes, minus the native dialog
// =============================================================================

import log from "electron-log/main";
import type { WebContents } from "electron";
import { platformOrigin } from "./platformUrls";
import { getPlatformSession } from "./platformSession";
import { bundledVersion, finCodes, type DaemonStatus } from "./fincodes/host";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** A load the shell may steer (redirect, rewrite) never settles on its own: cap it. */
const load = (page: WebContents, url: string) => Promise.race([page.loadURL(url).catch(() => undefined), wait(6_000)]);
const run = (page: WebContents, code: string) => Promise.race([page.executeJavaScript(code, true), wait(8_000).then(() => ({ error: "timed out" }))]);

export async function runFinCodesSmoke(page: WebContents): Promise<void> {
  const result = (name: string, ok: boolean, detail = "") => log.info(`SMOKE-FC ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  try {
    const running = await finCodes.ensureRunning();
    const status = running ? await finCodes.client.call<DaemonStatus>("daemon/status") : null;
    result("daemon starts under the app runtime", !!status && status.version === bundledVersion(), `${status?.version ?? "none"} vs bundled ${bundledVersion()}`);

    // The fake platform's session cookies (scripts/fake-platform.mjs), so /dashboard renders.
    for (const name of ["fc_session", "fc_handshake"]) await getPlatformSession().cookies.set({ url: platformOrigin(), name, value: "1" }).catch(() => undefined);
    const ask = "window.fincraftlyDesktop && window.fincraftlyDesktop.fincodes ? window.fincraftlyDesktop.fincodes.status() : 'no bridge'";
    await load(page, `${platformOrigin()}/dashboard/user_2test/AIWS`);
    await wait(1_500);
    log.info(`SMOKE-FC page at ${page.getURL()}`);
    const fromApp = await run(page, ask).catch((error: Error) => ({ error: error.message }));
    result("the signed-in app page reaches the bridge", (fromApp as { available?: boolean })?.available === true, JSON.stringify(fromApp).slice(0, 240));
    result("the page gets folder names, never paths", !JSON.stringify(fromApp).includes('"path"'));

    // (A page from another origin never stays in the platform view — the shell's navigation policy
    // sends it to the browser — so the only other case to prove is the platform's public pages.)
    for (const [label, url] of [["a public page on the platform", `${platformOrigin()}/`]] as const) {
      await load(page, url);
      await wait(700);
      const answer = await run(page, ask).catch((error: Error) => ({ error: error.message }));
      result(`${label} is refused`, answer === "no bridge" || (answer as { available?: boolean })?.available === false, JSON.stringify(answer).slice(0, 200));
    }

    const begun = await finCodes.call<{ paired: boolean; userCode?: string }>("pair/begin", {}, 30_000);
    if (begun.paired) result("pairing", true, "already paired");
    else {
      log.info(`SMOKE-FC CODE ${begun.userCode}`);
      let paired = false;
      for (let attempt = 0; attempt < 120 && !paired; attempt += 1) {
        await wait(1_000);
        paired = (await finCodes.call<{ paired: boolean }>("pair/state")).paired;
      }
      result("pairing completes after approval", paired);
    }

    const folder = process.env.FINCRAFTLY_SMOKE_FOLDER;
    if (folder) {
      const grant = await finCodes.call<{ ok: boolean; refused?: string; grant?: { workspaceId: string } }>("workspace/grant", { path: folder, profile: "guarded", confirmed: true }, 60_000);
      result("folder grant", grant.ok, grant.ok ? grant.grant?.workspaceId ?? "" : grant.refused ?? "");
    }
    log.info("SMOKE-FC DONE");
  } catch (error) {
    log.error("SMOKE-FC FAIL crashed", error);
  }
}
