// =============================================================================
// src/main/smoke.ts
// -----------------------------------------------------------------------------
// Scripted smoke test of the shell, run with FINCRAFTLY_SMOKE=1 against the
// fake platform (scripts/fake-platform.mjs). It drives the real UI through
// synthetic input events and asserts on what the platform page ends up showing.
// Never active in a packaged build. Results are logged as "SMOKE …" lines.
//
// Flow: signed-out start → welcome screen → "Sign in with your browser" →
// simulated fincraftly://auth deep link → AI Workspace → ⋯ menu → Settings →
// Home → theme toggle → Sign out → welcome screen again.
// =============================================================================

import { app, type WebContentsView } from "electron";
import log from "electron-log/main";
import { execFile } from "node:child_process";
import {
  CAPTION_CONTROLS_WIDTH,
  MENU_BUTTON_GAP,
  MENU_BUTTON_WIDTH,
  MENU_PANEL_PADDING,
  MENU_ROW_HEIGHT,
  MENU_ROW_WITH_HINT_HEIGHT,
  MENU_SEPARATOR_HEIGHT,
  SHELL_MENU,
  type AuthPhase,
} from "../shared/config";

export interface SmokeTarget {
  menuButton: WebContentsView;
  menu: WebContentsView;
  platform: WebContentsView;
  welcome: WebContentsView;
  contentWidth(): number;
  openDeepLink(link: string): void;
  pendingAuthState(): string | null;
  authPhase(): AuthPhase;
  welcomeShown(): boolean;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Full-display screenshot via ImageMagick when FINCRAFTLY_SMOKE_SHOTS=<dir> is set (Linux/Xvfb). */
function screenshot(name: string): Promise<void> {
  const dir = process.env.FINCRAFTLY_SMOKE_SHOTS;
  if (!dir) return Promise.resolve();
  return new Promise((resolve) => {
    execFile("import", ["-window", "root", `${dir}/${name}.png`], () => resolve());
  });
}

function click(view: WebContentsView, x: number, y: number): void {
  const contents = view.webContents;
  contents.sendInputEvent({ type: "mouseMove", x, y });
  contents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  contents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
}

/** Y centre of a menu row inside the menu view, by item id. */
function menuRowCentre(id: string): number {
  let y = MENU_PANEL_PADDING;
  for (const entry of SHELL_MENU) {
    if ("separator" in entry) { y += MENU_SEPARATOR_HEIGHT; continue; }
    const height = entry.hint ? MENU_ROW_WITH_HINT_HEIGHT : MENU_ROW_HEIGHT;
    if (entry.id === id) return y + height / 2;
    y += height;
  }
  throw new Error(`smoke: no menu item ${id}`);
}

export async function runSmoke(target: SmokeTarget): Promise<void> {
  if (app.isPackaged) return;
  const platform = target.platform.webContents;
  const heading = () => platform.executeJavaScript("document.getElementById('view')?.textContent ?? location.pathname", true) as Promise<string>;
  const theme = () => platform.executeJavaScript("document.documentElement.getAttribute('data-theme')", true) as Promise<string>;
  const topbarInset = () => platform.executeJavaScript(
    "(() => { const h = document.querySelector('header'); return h ? getComputedStyle(h).paddingRight : 'no header'; })()", true,
  ) as Promise<string>;
  const chromeReport = () => platform.executeJavaScript(
    `(() => {
      const shown = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).display !== "none" : "missing"; };
      const side = document.querySelector('[data-tour="sidebar-root"]');
      const active = document.querySelector('[data-tour="nav-AIWS"]');
      const idle = document.querySelector('[data-tour="nav-Invoices"]');
      const hydra = document.getElementById("fincraftly-desktop-hydra");
      const toggle = document.querySelector('button[aria-label="Toggle desktop mode"]');
      return [
        "notch shown=" + shown('[data-tour="tb-hydra"]'),
        "desktop toggle shown=" + shown('button[aria-label="Toggle desktop mode"]'),
        "hydra button=" + (hydra ? (hydra.nextElementSibling === toggle ? "in place" : "misplaced") : "missing"),
        "hydra classes match=" + (hydra && toggle ? hydra.className === toggle.className : false),
        "taskbar line shown=" + shown("#taskbar-line"),
        "taskbar shown=" + shown("#taskbar"),
        "sidebar shown=" + (side ? getComputedStyle(side).display !== "none" : "missing"),
        "sidebar bg=" + (side ? getComputedStyle(side).backgroundColor : "-"),
        "active row bg=" + (active ? getComputedStyle(active).backgroundColor : "-"),
        "active row color=" + (active ? getComputedStyle(active).color : "-"),
        "idle row color=" + (idle ? getComputedStyle(idle).color : "-"),
        "popout shown=" + shown('button[title^="Open "]'),
        "idle row bg=" + (idle ? getComputedStyle(idle).backgroundColor : "-"),
        "idle row appearance=" + (idle ? getComputedStyle(idle).appearance : "-"),
        "sidebar toggle shown=" + shown('[data-tour="tb-sidebar-toggle"]'),
        "sidebar expanded=" + document.querySelector('[data-tour="tb-sidebar-toggle"]').getAttribute("aria-expanded"),
        "hover strip shown=" + shown("#hover-strip"),
        "caption hole=" + (() => { const h = document.getElementById("fincraftly-desktop-caption-hole"); if (!h) return "missing"; const r = h.getBoundingClientRect(); return getComputedStyle(h).webkitAppRegion + " " + Math.round(r.width) + "x" + Math.round(r.height) + " at right " + Math.round(window.innerWidth - r.right); })(),
        "header drag=" + getComputedStyle(document.querySelector(".fin-desktop header")).webkitAppRegion,
      ].join(" | ");
    })()`, true,
  ).catch((error: Error) => "error " + error.message);

  const menuVisibleRows = () => target.menu.webContents.executeJavaScript(
    "document.querySelectorAll('.item').length", true,
  ).catch(() => -1);

  /** The element under the middle of the topbar must be the topbar, not the shell's drag strip. */
  const topbarClickable = () => platform.executeJavaScript(
    `(() => { const h = document.querySelector('.fin-desktop header [data-tour="tb-credits"]'); if (!h) return "no header"; const r = h.getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el && h.contains(el) ? "yes" : "NO — covered by " + (el ? el.id || el.tagName : "nothing"); })()`, true,
  ).catch(() => "error");
  // The ⋯ view is its own 44px-wide surface; click its centre.
  const openMenu = () => click(target.menuButton, MENU_BUTTON_WIDTH / 2, 18);
  void CAPTION_CONTROLS_WIDTH; void MENU_BUTTON_GAP;

  await wait(4000);
  log.info("SMOKE start; welcome shown =", target.welcomeShown(), "| phase =", target.authPhase());
  await screenshot("A-welcome");

  // 1. "Sign in with your browser" → waiting (the browser open fails harmlessly here).
  const welcomeButton = await target.welcome.webContents.executeJavaScript(
    "(() => { const b = document.getElementById('sign-in').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()", true,
  ) as { x: number; y: number };
  click(target.welcome, Math.round(welcomeButton.x), Math.round(welcomeButton.y));
  await wait(1200);
  log.info("SMOKE after click; phase =", target.authPhase(), "| pending state =", target.pendingAuthState() ? "set" : "none");
  await screenshot("B-waiting");

  // 2. The browser comes back with a ticket (simulated deep link).
  const state = target.pendingAuthState() ?? "";
  target.openDeepLink(`fincraftly://auth?ticket=smoke-ticket&state=${state}`);
  await wait(3500);
  log.info("SMOKE after ticket; welcome shown =", target.welcomeShown(), "| heading =", await heading(), "| topbar inset =", await topbarInset(), "| topbar clickable =", await topbarClickable());
  await screenshot("C-signed-in");

  // 3. The reshaped chrome: notch + Desktop toggle hidden, Hydra button in their
  //    place and wired to hydra:open, taskbar hidden, sidebar shown & restyled.
  log.info("SMOKE chrome;", await chromeReport());
  // The toggle must still open it, and the app must not fold it again.
  await platform.executeJavaScript("document.querySelector('[data-tour=tb-sidebar-toggle]').click()", true).catch(() => undefined);
  await wait(1500);
  log.info("SMOKE after expand; sidebar expanded =", await platform.executeJavaScript("document.querySelector('[data-tour=tb-sidebar-toggle]').getAttribute('aria-expanded')", true).catch(() => "?"));
  await screenshot("D-chrome");
  // The ⋯ menu opens, holds only shell actions, and stays open (Windows focus race).
  openMenu();
  await wait(1200);
  log.info("SMOKE menu open =", await menuVisibleRows(), "rows");
  await screenshot("E-menu-open");
  platform.executeJavaScript("document.getElementById('fincraftly-desktop-hydra').click()", true).catch(() => undefined);
  await wait(400);
  log.info("SMOKE after Hydra click;", await platform.executeJavaScript("document.getElementById('hydra').textContent", true));

  // 4. Theme toggle inside the platform → the shell must follow.
  platform.executeJavaScript("(() => { const b = document.getElementById('theme'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()", true)
    .then((at: { x: number; y: number }) => click(target.platform, Math.round(at.x), Math.round(at.y)))
    .catch(() => click(target.platform, 280, 30));
  await wait(2500);
  log.info("SMOKE after theme toggle; theme =", await theme());
  await screenshot("E-theme");

  // 5. Sign out → welcome again.
  openMenu();
  await wait(600);
  click(target.menu, 120, menuRowCentre("sign-out"));
  await wait(2500);
  log.info("SMOKE after sign-out; welcome shown =", target.welcomeShown(), "| phase =", target.authPhase());
  await screenshot("F-signed-out");
}
