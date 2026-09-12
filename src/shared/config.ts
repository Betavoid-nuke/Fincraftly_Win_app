// =============================================================================
// src/shared/config.ts
// -----------------------------------------------------------------------------
// The single place that knows WHAT the desktop app wraps. Everything about the
// platform that the shell depends on — origin, routes, the views it may show,
// the menu that replaces the platform sidebar — lives here, so a platform
// change is a one-file edit on this side.
//
// Shared between the main process, the preloads and the titlebar renderer, so
// keep it free of Electron / DOM imports.
// =============================================================================

/** Production origin of the FinCraftly platform (overridable via env for dev). */
export const DEFAULT_PLATFORM_ORIGIN = "https://fincraftly.com";

/** Version string reported to the platform through a request header. */
export const DESKTOP_HEADER_NAME = "X-FinCraftly-Desktop";

/**
 * Dashboard route shape on the platform: `/dashboard/{clerkUserId}/{viewSlug}`.
 * The slug picks the page rendered inside the platform's single dashboard
 * page component, so the shell navigates by rewriting it.
 */
export const DASHBOARD_PATH_PATTERN = /^\/dashboard\/([^/]+)\/([^/?#]+)/;

/** Legacy alias of the dashboard route that the platform still serves. */
export const LEGACY_DASHBOARD_PATH_PATTERN = /^\/invoicegenerator\/([^/?#]+)/;

/** The one page this app is about. */
export const HOME_VIEW = "AIWS";

/**
 * Where the app starts and where a completed sign-in lands. The platform's
 * `/platform/{view}` resolver forwards a signed-in user straight to
 * `/dashboard/{userId}/{view}` — so this lands on the AI Workspace directly,
 * with no detour through the finance dashboard. Signed out, the platform
 * bounces it to /sign-in, which the shell shows as the welcome screen.
 */
export const DASHBOARD_ENTRY_PATH = `/platform/${HOME_VIEW}`;

/**
 * Hosts that are part of signing in to the platform even though they are not
 * the platform's origin. Clerk (the platform's auth provider) serves its
 * frontend API from `clerk.fincraftly.com`; when a page load finds the
 * session cookie missing or stale, the platform's middleware redirects there
 * (the "handshake") and Clerk redirects straight back to fincraftly.com with
 * a fresh session. That hop MUST stay inside the app: sending it to the
 * browser leaves the window blank and signs the browser in instead — which is
 * exactly the 1.1.3 "app is empty, the platform opened in Chrome" bug.
 */
export const PLATFORM_AUTH_HOST_PATTERNS: readonly RegExp[] = [
  /(^|\.)clerk\.fincraftly\.com$/i,
  /(^|\.)accounts\.fincraftly\.com$/i,
  /(^|\.)clerk\.accounts\.dev$/i,
  /(^|\.)clerk\.com$/i,
];

/**
 * Views a `fincraftly://<view>` deep link may open. Since the platform's own
 * sidebar is shown in the app (v1.2), every dashboard view is reachable — the
 * shell no longer rewrites URLs to the AI Workspace; it only STARTS there.
 * The legacy `/invoicegenerator/{view}` route is still steered to the entry
 * URL because it carries no user id.
 */
export const ALLOWED_VIEWS: ReadonlySet<string> | null = null;

/** One row of the ⋯ menu that replaces the platform's left sidebar. */
export interface ShellMenuItem {
  /** Stable id used in IPC. */
  id: string;
  label: string;
  /**
   * Platform view slug to navigate to. Absent for shell actions
   * (reload, sign out, …) which the main process handles by id.
   */
  view?: string;
  /** Lucide-style icon name, drawn by the titlebar renderer. */
  icon: string;
  /** Muted secondary line shown under the label. */
  hint?: string;
  /** Renders in the accent colour and pinned as the first row. */
  primary?: boolean;
  /** Renders in the danger colour. */
  danger?: boolean;
}

export type ShellMenuEntry = ShellMenuItem | { separator: true };

/**
 * The ⋯ menu, top to bottom. This is the whole "rest of the platform" as far
 * as the desktop app is concerned: the pages that used to be sidebar rows.
 */
export const SHELL_MENU: readonly ShellMenuEntry[] = [
  { id: "open-in-browser", label: "Open in browser", icon: "external" },
  { id: "reload", label: "Reload", icon: "refresh" },
  { id: "about", label: "About FinCraftly", icon: "info" },
  { separator: true },
  { id: "sign-out", label: "Sign out", icon: "logout", danger: true },
];

/** Shell theme, mirrored from the platform's `<html data-theme>`. */
export type ShellTheme = "dark" | "light";

/**
 * Brand tokens (lib/theme/brandTokens.ts on the platform). The titlebar is
 * painted with these so it reads as part of the page, not as a frame around it.
 */
export const THEME_TOKENS: Record<ShellTheme, {
  background: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  danger: string;
  hover: string;
  /** Windows caption-button glyph colour (min / max / close). */
  symbol: string;
}> = {
  dark: {
    background: "#121417",
    surface: "#1B1F24",
    border: "rgba(154,162,174,0.16)",
    text: "#F7F6F3",
    textMuted: "#9AA2AE",
    accent: "#4E84F3",
    danger: "#E05C5C",
    hover: "rgba(247,246,243,0.06)",
    symbol: "#C6CBD3",
  },
  light: {
    background: "#F7F6F3",
    surface: "#FFFFFF",
    border: "rgba(18,20,23,0.12)",
    text: "#121417",
    textMuted: "#5F6873",
    accent: "#4E84F3",
    danger: "#C94848",
    hover: "rgba(18,20,23,0.06)",
    symbol: "#121417",
  },
};

/**
 * Height of the Windows caption-button overlay (minimize / maximize / close).
 * The OS draws it over the top-right corner of the page; nothing else of ours
 * sits in that row except the ⋯ button beside it.
 */
export const CAPTION_CONTROLS_HEIGHT = 36;

/**
 * Width Windows reserves for the caption buttons at 100 % scale. The platform
 * page is padded by this much (plus the ⋯ button) on the right so nothing of
 * its own topbar ends up underneath the buttons.
 */
export const CAPTION_CONTROLS_WIDTH = 138;

/**
 * The ⋯ button: a tiny view of its own, flush against the caption buttons and
 * cut to their exact size — Windows 11 draws each caption button 46 DIP wide —
 * so the row reads as four buttons, not three plus a stray.
 */
export const MENU_BUTTON_WIDTH = 46;
export const MENU_BUTTON_GAP = 0;

/** Right inset the platform topbar gets, with and without the caption overlay. */
export const TOPBAR_INSET_WINDOWED = CAPTION_CONTROLS_WIDTH + MENU_BUTTON_WIDTH + MENU_BUTTON_GAP + 8;
export const TOPBAR_INSET_FULLSCREEN = MENU_BUTTON_WIDTH + MENU_BUTTON_GAP + 8;

/** Path on the platform that signs a browser session over to the app. */
export const DESKTOP_SIGN_IN_PATH = "/desktop/sign-in";

/** Size of the ⋯ dropdown panel (its own view, so it needs fixed bounds). */
export const MENU_PANEL_WIDTH = 220;

/** Row heights used to compute the dropdown's height from SHELL_MENU. */
export const MENU_ROW_HEIGHT = 40;
export const MENU_ROW_WITH_HINT_HEIGHT = 48;
export const MENU_SEPARATOR_HEIGHT = 9;
export const MENU_PANEL_PADDING = 6;

export function computeMenuPanelHeight(): number {
  let height = MENU_PANEL_PADDING * 2;
  for (const entry of SHELL_MENU) {
    if ("separator" in entry) height += MENU_SEPARATOR_HEIGHT;
    else height += entry.hint ? MENU_ROW_WITH_HINT_HEIGHT : MENU_ROW_HEIGHT;
  }
  return height;
}

/** IPC channel names, in one place so both sides cannot drift. */
export const IPC = {
  // shell renderers (⋯ button, menu panel, welcome screen) → main
  menuToggle: "shell:menu:toggle",
  menuClose: "shell:menu:close",
  menuAction: "shell:menu:action",
  signInStart: "shell:auth:start",
  signInCancel: "shell:auth:cancel",
  rendererReady: "shell:renderer:ready",
  // main → shell renderers
  stateChanged: "shell:state",
  // platform preload → main
  platformTheme: "platform:theme",
  platformReady: "platform:ready",
} as const;

/** Where the signed-out screen is in the browser hand-off. */
export type AuthPhase = "idle" | "waiting" | "completing" | "error";

/** Everything the shell renderers need to paint themselves; pushed by main on change. */
export interface ShellState {
  theme: ShellTheme;
  isFullScreen: boolean;
  menuOpen: boolean;
  authPhase: AuthPhase;
  /** Human-readable reason when authPhase is "error". */
  authError: string;
  appVersion: string;
}
