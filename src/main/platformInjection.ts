// =============================================================================
// src/main/platformInjection.ts
// -----------------------------------------------------------------------------
// The stylesheet and script the shell injects into every platform page. This
// is the ONLY place the desktop app reshapes the web platform, and it does so
// from the outside — hiding, restyling and adding one button — so the platform
// code stays untouched and the web app is unaffected.
//
// What the desktop app changes, and why (all of it Jay's spec, 2026-09-05):
//   • the Hydra "notch" hanging from the top centre is gone; a plain Hydra
//     button takes the place of the "Desktop" (OS-mode) toggle, which is gone
//     too — the OS-mode metaphor is not part of the Windows app;
//   • the platform's left sidebar IS shown (with its collapse button in the
//     topbar), restyled to the AI Workspace rail's language: near-black rail,
//     grey uppercase section captions, neutral (never blue) selection, icons
//     in the text colour, sidebar-style rows — and it is MANUAL: folded on
//     arrival, no hover-to-open edge strip, the toggle is the only control;
//   • the FinOS taskbar at the foot of the window (the glowing line you hover
//     to lift it) is hidden;
//   • the topbar keeps clear of the Windows caption buttons + the ⋯ button and
//     drags the window; pages without the topbar get a transparent drag strip.
//
// Selectors are the platform's own stable hooks (`data-tour` attributes it
// uses for the guided tour, aria-labels) rather than styling classes, so a
// visual refresh on the platform does not silently break the desktop app.
// This whole file is a template literal: no backticks inside it.
// =============================================================================

/** The AI Workspace rail's palette (components/aiws/workspace/palette.ts + WorkspaceChatStyles). */
const RAIL_CANVAS = "#121417";
const RAIL_TEXT = "#F7F6F3";
const RAIL_TEXT_MUTED = "#9AA2AE";
const RAIL_CAPTION = "#5F6873";
const RAIL_BORDER = "rgba(154,162,174,0.18)";
const RAIL_ROW_HOVER = "rgba(255,255,255,0.06)";
const RAIL_ROW_ACTIVE = "rgba(255,255,255,0.09)";
const RAIL_ROW_ACTIVE_BORDER = "rgba(255,255,255,0.10)";
const RAIL_PILL = "#1F242B";
const RAIL_PILL_HOVER = "#262C34";

export const PLATFORM_CSS = `
/* ═══ FinCraftly Desktop — the platform reshaped for the Windows app ═══ */

/* ── 1. Topbar: no notch, no Desktop toggle; a Hydra button instead ─────── */
[data-tour="tb-hydra"] {
  display: none !important;
}
button[aria-label="Toggle desktop mode"] {
  display: none !important;
}
/* Our Hydra button clones the Desktop toggle's own classes + inline style, so
   it inherits the pill exactly; only the hover/press feedback is ours (the
   original's came from framer-motion). */
#fincraftly-desktop-hydra {
  cursor: pointer;
  transition: transform 120ms ease, background-color 120ms ease;
}
#fincraftly-desktop-hydra:hover { transform: scale(1.06); }
#fincraftly-desktop-hydra:active { transform: scale(0.94); }
#fincraftly-desktop-hydra img { width: 16px; height: 16px; object-fit: contain; display: block; }

/* ── 2. The FinOS taskbar (bottom glowing line + the bar it lifts) ──────── */
[class*="z-[9994]"].fixed.bottom-0,
[class*="z-[9995]"].fixed.bottom-0 {
  display: none !important;
}

/* ── 3. The platform sidebar, in the AI Workspace rail's language ───────── */
/* Manual only: the invisible strip on the window's left edge that pulls the
   sidebar out on hover (the platform's auto-collapse feature) is gone. The
   toggle in the topbar is the one way to open and close it. PLATFORM_JS also
   folds it once on arrival, so the app starts with the workspace full-width. */
.fin-desktop > div > div[aria-hidden].absolute.left-0.top-0.bottom-0.w-2 {
  display: none !important;
}
[data-tour="sidebar-root"] {
  background: ${RAIL_CANVAS} !important;
  border-right: 1px solid ${RAIL_BORDER};
  color: ${RAIL_TEXT} !important;
}
/* Resize handle: no blue. */
[data-tour="sidebar-root"] > .cursor-col-resize:hover { background: transparent !important; }
[data-tour="sidebar-root"] > .cursor-col-resize > div { background: transparent !important; }
[data-tour="sidebar-root"] > .cursor-col-resize:hover > div { background: ${RAIL_BORDER} !important; }

/* Brand row: tighter, like the rail's head. */
[data-tour="sidebar-root"] > .h-16 { height: 52px !important; padding-left: 14px !important; }
[data-tour="sidebar-root"] > .h-16 img { width: 22px !important; height: 22px !important; }
[data-tour="sidebar-root"] > .h-16 span {
  font-size: 13.5px !important;
  font-weight: 600 !important;
  letter-spacing: 0 !important;
  color: ${RAIL_TEXT} !important;
}

/* Section captions → .aiwc-sec-head. */
[data-tour="sidebar-root"] nav { padding: 6px 8px 12px !important; scrollbar-width: thin; scrollbar-color: rgba(154,162,174,0.25) transparent; }
[data-tour="sidebar-root"] nav::-webkit-scrollbar { width: 6px; }
[data-tour="sidebar-root"] nav::-webkit-scrollbar-thumb { background: rgba(154,162,174,0.25) !important; border-radius: 3px; }
[data-tour="sidebar-root"] nav > div { margin-top: 10px !important; }
[data-tour="sidebar-root"] nav > div > button {
  height: 26px;
  padding: 0 6px 0 10px !important;
  margin-bottom: 2px !important;
  background: transparent !important;
  border: 0 !important;
  border-radius: 6px;
}
[data-tour="sidebar-root"] nav > div > button:hover { background: ${RAIL_ROW_HOVER} !important; }
[data-tour="sidebar-root"] nav > div > button > span {
  font-size: 10.5px !important;
  font-weight: 800 !important;
  letter-spacing: .1em !important;
  color: ${RAIL_CAPTION} !important;
}
[data-tour="sidebar-root"] nav > div > button svg { color: ${RAIL_CAPTION} !important; width: 12px; height: 12px; }

/* Rows → .aiwc-nav-item: one tone step for hover, one more for the open page,
   full-strength text, no accent fill, no accent border, no coloured icon.

   appearance:none is LOAD-BEARING. This sheet is injected at USER origin, and
   when the winning background declaration on a <button> comes from a user
   sheet Chromium treats the control as "unstyled by the page" and paints its
   native theme over it — the grey #6B6B6B ButtonFace slabs Jay saw in 1.2.0.
   The computed background reads "transparent" while the pixels are grey. */
[data-tour="sidebar-root"] button {
  -webkit-appearance: none !important;
  appearance: none !important;
}
[data-tour="sidebar-root"] nav button[data-tour^="nav-"] {
  gap: 10px !important;
  padding: 7px 10px !important;
  border-radius: 9px !important;
  border: 1px solid transparent !important;
  background: transparent !important;
  color: ${RAIL_TEXT_MUTED} !important;
  font-size: 13px !important;
  font-weight: 500 !important;
  box-shadow: none !important;
}
[data-tour="sidebar-root"] nav button[data-tour^="nav-"]:hover {
  background: ${RAIL_ROW_HOVER} !important;
  color: ${RAIL_TEXT} !important;
}
[data-tour="sidebar-root"] nav button[data-tour^="nav-"] > span {
  color: inherit !important;
  opacity: 1 !important;
  font-weight: inherit !important;
}
[data-tour="sidebar-root"] nav button[data-tour^="nav-"] > span:first-child svg { width: 16px; height: 16px; }
/* The open page: the platform marks it with an inline accent border; we key
   off that (a transparent border is every other row) to paint it neutral. */
[data-tour="sidebar-root"] nav button[data-tour^="nav-"][style*="border: 1px solid rgba("] {
  background: ${RAIL_ROW_ACTIVE} !important;
  border-color: ${RAIL_ROW_ACTIVE_BORDER} !important;
  color: ${RAIL_TEXT} !important;
  font-weight: 650 !important;
}
[data-tour="sidebar-root"] nav button[data-tour^="nav-"][style*="border: 1px solid rgba("]:hover {
  background: rgba(255,255,255,0.12) !important;
}
/* "Open in window" pop-out (FinOS floating windows): not in the Windows app. */
[data-tour="sidebar-root"] nav .group\\/navitem > button[title^="Open "] { display: none !important; }

/* Plan card at the foot: the rail's raised surface, and a sidebar-row button
   instead of the accent-blue slab. */
[data-tour="sidebar-root"] > .p-4 > div {
  background: ${RAIL_PILL} !important;
  border: 1px solid ${RAIL_BORDER} !important;
  border-radius: 10px !important;
}
[data-tour="sidebar-root"] > .p-4 > div > div > div:first-child {
  background: rgba(255,255,255,0.06) !important;
  border: 1px solid ${RAIL_BORDER} !important;
}
[data-tour="sidebar-root"] > .p-4 > div > div > div:first-child svg { color: ${RAIL_TEXT_MUTED} !important; }
[data-tour="sidebar-root"] > .p-4 > div > div span:first-child { color: ${RAIL_TEXT} !important; }
[data-tour="sidebar-root"] > .p-4 > div > div span:last-child { color: ${RAIL_TEXT_MUTED} !important; }
[data-tour="sidebar-root"] > .p-4 > div > button {
  height: 34px;
  background: ${RAIL_CANVAS} !important;
  border: 1px solid ${RAIL_BORDER} !important;
  border-radius: 8px !important;
  color: ${RAIL_TEXT} !important;
  font-size: 13px !important;
  font-weight: 500 !important;
  box-shadow: none !important;
  filter: none !important;
}
[data-tour="sidebar-root"] > .p-4 > div > button:hover { background: ${RAIL_PILL_HOVER} !important; }

/* ── 4. Window chrome ───────────────────────────────────────────────────── */
/* The window has no titlebar of its own: the platform's topbar IS the top of
   the window. Windows draws its caption buttons over the top-right corner and
   the shell parks its ⋯ button beside them, so the bar keeps clear of that
   corner (--fc-topbar-inset, set by the shell: smaller in full screen) and
   drags the window — except on its own controls. */
.fin-desktop header:has([data-tour="tb-credits"]) {
  position: relative;
  padding-right: var(--fc-topbar-inset, 192px) !important;
  -webkit-app-region: drag;
  app-region: drag;
}
.fin-desktop header:has([data-tour="tb-credits"]) :is(button, a, input, textarea, select, summary, [role="button"], [role="menuitem"], [role="combobox"], [contenteditable]) {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}
/* THE HOLE UNDER THE ⋯ BUTTON. The header's box runs to the window's right
   edge — the padding above is still part of it — so its drag region covered
   the strip where the shell's ⋯ view sits. Electron merges drag regions from
   every view in the window, so Windows hit-tested that strip as title bar:
   the ⋯ click went to the OS (double-click = maximize) and never reached the
   button. A no-drag box over the inset is subtracted from the merged region.
   Inserted by PLATFORM_JS; pointer-events:none so it blocks nothing. */
#fincraftly-desktop-caption-hole {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--fc-topbar-inset, 192px);
  pointer-events: none;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

/* Pages without that topbar (the sign-in page while a ticket completes, an
   auth hop, an error page) still need somewhere to grab the window by: a
   transparent strip the height of the caption buttons. It is inserted by
   PLATFORM_JS and hidden the moment the platform's own draggable bar exists,
   so it never sits on top of the workspace. */
#fincraftly-desktop-drag-strip {
  position: fixed;
  top: 0;
  left: 0;
  right: var(--fc-topbar-inset, 192px);
  height: 36px;
  z-index: 2147483646;
  pointer-events: auto;
  -webkit-app-region: drag;
  app-region: drag;
}
/* NOTE: a :has() nested inside :has() is INVALID CSS — the whole rule is
   dropped and the strip then covers the topbar's buttons (the 1.1.4 bug). Keep
   this selector flat; PLATFORM_JS toggles the hidden attribute too as a safety net. */
html:has(.fin-desktop header [data-tour="tb-credits"]) #fincraftly-desktop-drag-strip,
#fincraftly-desktop-drag-strip[hidden] {
  display: none !important;
}

/* The shell already draws a window frame; never let the page double it. */
html, body {
  overscroll-behavior: none;
}
`;

/** Sets the topbar's right inset (caption buttons + ⋯) from the main process. */
export function topbarInsetScript(insetPx: number): string {
  return `document.documentElement.style.setProperty("--fc-topbar-inset", "${Math.round(insetPx)}px");`;
}

/**
 * Runs inside the platform page after every load. Marks the document so the
 * platform (or its CSS) can tell it is inside the desktop app, keeps the
 * fallback drag strip in step with the topbar, and places the Hydra button
 * where the Desktop toggle used to be — re-checking on every DOM change,
 * because the topbar is React-rendered and may be rebuilt at any time.
 */
export const PLATFORM_JS = `
(() => {
  try {
    document.documentElement.setAttribute("data-fincraftly-desktop", "1");
  } catch {}

  const DRAG_STRIP_ID = "fincraftly-desktop-drag-strip";
  const HYDRA_ID = "fincraftly-desktop-hydra";
  const TOPBAR = '.fin-desktop header [data-tour="tb-credits"]';
  const DESKTOP_TOGGLE = 'button[aria-label="Toggle desktop mode"]';

  // ── The fallback drag handle (see PLATFORM_CSS). Idempotent per document. ──
  const syncDragStrip = () => {
    let strip = document.getElementById(DRAG_STRIP_ID);
    if (!strip) {
      strip = document.createElement("div");
      strip.id = DRAG_STRIP_ID;
      strip.setAttribute("aria-hidden", "true");
      (document.body || document.documentElement).appendChild(strip);
    }
    const hasTopbar = !!document.querySelector(TOPBAR);
    if (strip.hidden !== hasTopbar) strip.hidden = hasTopbar;
  };

  // ── The Hydra button, in the Desktop toggle's place. ──
  // The toggle is hidden by CSS but stays in the DOM, so it is a reliable
  // anchor: we sit right before it and borrow its classes and inline style
  // (the pill), so the button is pixel-identical to its neighbours.
  const syncHydraButton = () => {
    const toggle = document.querySelector(DESKTOP_TOGGLE);
    let button = document.getElementById(HYDRA_ID);
    if (!toggle) {
      if (button) button.remove();
      return;
    }
    if (!button) {
      button = document.createElement("button");
      button.id = HYDRA_ID;
      button.type = "button";
      button.title = "Ask Hydra — your AI copilot";
      button.setAttribute("aria-label", "Ask Hydra");
      button.setAttribute("data-tour", "tb-hydra-desktop");
      const mark = document.createElement("img");
      mark.src = "/hydraLogo/blue.svg";
      mark.alt = "";
      mark.width = 16;
      mark.height = 16;
      mark.addEventListener("error", () => { mark.src = "/Logos/blue.svg"; }, { once: true });
      const label = document.createElement("span");
      label.className = "relative hidden lg:inline text-[12px] font-semibold";
      label.style.color = "var(--text-2)";
      label.textContent = "Hydra";
      button.append(mark, label);
      // The platform's topbar listens for this event (the notch used to send it).
      button.addEventListener("click", () => window.dispatchEvent(new Event("hydra:open")));
    }
    // Keep the look in step with the toggle's (classes/style may re-render).
    if (button.className !== toggle.className) button.className = toggle.className;
    const style = toggle.getAttribute("style") || "";
    if (button.getAttribute("data-fc-style") !== style) {
      button.setAttribute("style", style);
      button.setAttribute("data-fc-style", style);
    }
    if (button.nextElementSibling !== toggle) toggle.parentNode.insertBefore(button, toggle);
  };

  // ── Collapsed on arrival. ──
  // The platform opens its sidebar with the page (and, with auto-collapse on
  // in the person's settings, folds it after a few seconds and re-opens it on
  // hover). In the app it starts folded and only the topbar toggle moves it:
  // press the platform's own collapse button ONCE per document, as soon as it
  // is mounted and hydrated (a click before hydration does nothing, so keep
  // trying until the toggle reports "collapsed", for at most 15 seconds).
  const SIDEBAR_TOGGLE = '[data-tour="tb-sidebar-toggle"]';
  const startedAt = Date.now();
  let lastTry = 0;
  const syncSidebarStart = () => {
    if (window.__fincraftlyDesktopSidebarFolded) return;
    const toggle = document.querySelector(SIDEBAR_TOGGLE);
    if (!toggle) return;
    if (toggle.getAttribute("aria-expanded") === "false") { window.__fincraftlyDesktopSidebarFolded = true; return; }
    const now = Date.now();
    if (now - startedAt > 15000) { window.__fincraftlyDesktopSidebarFolded = true; return; }
    if (now - lastTry < 300) return;
    lastTry = now;
    toggle.click();
  };

  // ── The no-drag hole in the topbar, under the shell's ⋯ button (see CSS). ──
  const HOLE_ID = "fincraftly-desktop-caption-hole";
  const syncCaptionHole = () => {
    const credits = document.querySelector(TOPBAR);
    const header = credits ? credits.closest("header") : null;
    let hole = document.getElementById(HOLE_ID);
    if (!header) { if (hole) hole.remove(); return; }
    if (!hole) {
      hole = document.createElement("div");
      hole.id = HOLE_ID;
      hole.setAttribute("aria-hidden", "true");
    }
    if (hole.parentNode !== header) header.appendChild(hole);
  };

  const sync = () => {
    try { syncDragStrip(); } catch {}
    try { syncCaptionHole(); } catch {}
    try { syncHydraButton(); } catch {}
    try { syncSidebarStart(); } catch {}
  };
  sync();
  // Coalesce the platform's constant DOM churn into one check per frame.
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; sync(); });
  };
  if (!window.__fincraftlyDesktopObserver) {
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.__fincraftlyDesktopObserver = observer;
  }
})();
`;
