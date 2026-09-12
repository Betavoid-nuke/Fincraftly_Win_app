// =============================================================================
// src/main/shellWindow.ts
// -----------------------------------------------------------------------------
// The application window. One frameless BaseWindow, no titlebar of its own:
//
//   ┌────────────────────────────────────────────────────────── ⋯ ─ □ ✕ ┐
//   │ platform view  (https://fincraftly.com/dashboard/…)              │
//   │   — or —                                          ┌───────────┐  │
//   │ welcome view   (local: "Sign in with your browser") │ menu view │  │
//   │                                                   └───────────┘  │
//   └──────────────────────────────────────────────────────────────────┘
//
// The minimize / maximize / close buttons are Windows' own, drawn by the OS
// through `titleBarOverlay` over the top-right corner — exactly the Claude
// desktop treatment — and recoloured to the platform's theme on every theme
// change. The ⋯ button is a 46px view of its own beside them; the platform's
// topbar is padded away from that corner and made draggable by injected CSS.
//
// Sign-in never happens inside this window. When the platform says "signed
// out" (a redirect to /sign-in) the welcome view takes over, opens the
// platform's /desktop/sign-in page in the person's browser, and waits for the
// `fincraftly://auth?ticket=…&state=…` deep link. The ticket is a single-use
// Clerk sign-in token that the app's own session consumes via
// /sign-in?__clerk_ticket — after which the platform loads as usual.
//
// The main process owns all state; the renderers are dumb painters that
// receive `ShellState` and send back intents (IPC).
// =============================================================================

import {
  app,
  BaseWindow,
  dialog,
  ipcMain,
  shell,
  WebContentsView,
  type IpcMainEvent,
  type Rectangle,
  type WebContents,
} from "electron";
import log from "electron-log/main";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import {
  ALLOWED_VIEWS,
  CAPTION_CONTROLS_HEIGHT,
  CAPTION_CONTROLS_WIDTH,
  computeMenuPanelHeight,
  IPC,
  MENU_BUTTON_GAP,
  MENU_BUTTON_WIDTH,
  MENU_PANEL_WIDTH,
  SHELL_MENU,
  THEME_TOKENS,
  TOPBAR_INSET_FULLSCREEN,
  TOPBAR_INSET_WINDOWED,
  type AuthPhase,
  type ShellMenuItem,
  type ShellState,
  type ShellTheme,
} from "../shared/config";
import { PLATFORM_CSS, PLATFORM_JS, topbarInsetScript } from "./platformInjection";
import { clearPlatformSession, getPlatformSession } from "./platformSession";
import {
  dashboardUrl,
  desktopSignInUrl,
  entryUrl,
  isExternalScheme,
  isPlatformAuthHop,
  isPlatformUrl,
  isSignedOutUrl,
  parseDashboardUrl,
  platformOrigin,
  rewriteForDesktop,
  signInUrl,
} from "./platformUrls";
import {
  readWindowState,
  resolveInitialBounds,
  WINDOW_MIN_SIZE,
  writeWindowState,
} from "./windowState";

const IS_DEV = process.env.FINCRAFTLY_DEV === "1";

/** Host + path of a URL for the log — never its query string (tickets, tokens). */
function safeHost(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "<invalid url>";
  }
}

const MENU_REOPEN_GUARD_MS = 250;
/** How long a blur may be a mere focus hand-off between views before it counts as "closed". */
const MENU_BLUR_SETTLE_MS = 120;
const MENU_PANEL_HEIGHT = computeMenuPanelHeight();

/** Chromium's "navigation aborted" code — not an error worth an offline page. */
const ERR_ABORTED = -3;
/** Chromium's generic failure code — also what a redirect we cancelled reports as. */
const ERR_FAILED = -2;

/** How long the hand-off may take once the ticket is in hand before we give up. */
const TICKET_COMPLETION_TIMEOUT_MS = 25_000;

export class ShellWindow {
  readonly window: BaseWindow;
  private readonly platform: WebContentsView;
  private readonly welcome: WebContentsView;
  private readonly menuButton: WebContentsView;
  private readonly menu: WebContentsView;

  private state: ShellState;
  private lastKnownUserId: string | null = null;
  private menuClosedAt = 0;
  private destroyed = false;
  private welcomeShown = false;
  /** Nonce of the browser sign-in currently in flight; null when none. */
  private pendingAuthState: string | null = null;
  /** The last ticket handed over, so duplicate launches of the same link are ignored. */
  private lastTicket: string | null = null;
  private ticketTimer: NodeJS.Timeout | null = null;
  /** URL to retry from the offline page. */
  private lastAttemptedUrl: string = entryUrl();

  constructor() {
    const persisted = readWindowState();
    // Dark by default, always. The shell only ever follows the theme the
    // signed-in platform declares while that page is on screen.
    const theme: ShellTheme = "dark";
    const tokens = THEME_TOKENS[theme];
    const bounds = resolveInitialBounds(persisted.bounds);

    this.state = {
      theme,
      isFullScreen: false,
      menuOpen: false,
      authPhase: "idle",
      authError: "",
      appVersion: app.getVersion(),
    };

    this.window = new BaseWindow({
      ...bounds,
      minWidth: WINDOW_MIN_SIZE.width,
      minHeight: WINDOW_MIN_SIZE.height,
      show: false,
      title: "FinCraftly",
      backgroundColor: tokens.background,
      icon: join(__dirname, "../renderer/assets/icon.png"),
      // Frameless with the OS-drawn caption controls: the Claude-desktop look.
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: tokens.background,
        symbolColor: tokens.symbol,
        height: CAPTION_CONTROLS_HEIGHT,
      },
    });

    this.platform = this.createPlatformView();
    this.welcome = this.createShellView("welcome.html", tokens.background);
    this.menuButton = this.createShellView("menubutton.html", tokens.background);
    this.menu = this.createShellView("menu.html", tokens.surface);

    // Order = z-order.
    this.window.contentView.addChildView(this.platform);
    this.window.contentView.addChildView(this.welcome);
    this.window.contentView.addChildView(this.menuButton);
    this.window.contentView.addChildView(this.menu);
    this.welcome.setVisible(false);
    this.menu.setVisible(false);

    this.wireWindowEvents();
    this.wirePlatformEvents();
    this.wireIpc();
    this.layout();

    if (persisted.isMaximized) this.window.maximize();

    this.navigateTo(entryUrl());

    if (process.env.FINCRAFTLY_SMOKE === "1" && !app.isPackaged) {
      void import("./smoke").then(({ runSmoke }) => runSmoke({
        menuButton: this.menuButton,
        menu: this.menu,
        platform: this.platform,
        welcome: this.welcome,
        contentWidth: () => this.window.getContentBounds().width,
        openDeepLink: (link) => this.openDeepLink(link),
        pendingAuthState: () => this.pendingAuthState,
        authPhase: () => this.state.authPhase,
        welcomeShown: () => this.welcomeShown,
      })).catch((error) => log.error("smoke", error));
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // View construction
  // ───────────────────────────────────────────────────────────────────────────

  private createPlatformView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        session: getPlatformSession(),
        preload: join(__dirname, "../preload/platformPreload.js"),
        additionalArguments: [`--fincraftly-version=${app.getVersion()}`],
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: true,
        backgroundThrottling: false,
        devTools: IS_DEV,
      },
    });
    view.setBackgroundColor(THEME_TOKENS[this.state.theme].background);
    return view;
  }

  private createShellView(file: string, backgroundColor: string): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, "../preload/shellPreload.js"),
        contextIsolation: true,
        sandbox: false, // local, trusted HTML; needs to require shared config
        nodeIntegration: false,
        devTools: IS_DEV,
      },
    });
    view.setBackgroundColor(backgroundColor);
    view.webContents.loadFile(join(__dirname, "../renderer", file)).catch((error) => log.error(file, error));
    // Nothing inside the shell's own pages may navigate anywhere.
    view.webContents.on("will-navigate", (event) => event.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.wireShortcuts(view.webContents);
    return view;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Layout
  // ───────────────────────────────────────────────────────────────────────────

  private layout(): void {
    if (this.destroyed) return;
    const { width, height } = this.window.getContentBounds();
    const full = { x: 0, y: 0, width, height };
    this.platform.setBounds(full);
    this.welcome.setBounds(full);
    this.menuButton.setBounds(this.menuButtonBounds(width));
    this.menu.setBounds(this.menuBounds(width, height));
  }

  private captionInset(): number {
    return this.state.isFullScreen ? 0 : CAPTION_CONTROLS_WIDTH;
  }

  private menuButtonBounds(width: number): Rectangle {
    return {
      x: Math.max(0, width - this.captionInset() - MENU_BUTTON_GAP - MENU_BUTTON_WIDTH),
      y: 0,
      width: MENU_BUTTON_WIDTH,
      height: CAPTION_CONTROLS_HEIGHT,
    };
  }

  private menuBounds(width: number, height: number): Rectangle {
    const right = width - this.captionInset() - MENU_BUTTON_GAP;
    const panelHeight = Math.min(MENU_PANEL_HEIGHT, Math.max(0, height - CAPTION_CONTROLS_HEIGHT - 8));
    return {
      x: Math.max(0, right - MENU_PANEL_WIDTH),
      y: CAPTION_CONTROLS_HEIGHT + 4,
      width: MENU_PANEL_WIDTH,
      height: panelHeight,
    };
  }

  private applyTopbarInset(): void {
    const inset = this.state.isFullScreen ? TOPBAR_INSET_FULLSCREEN : TOPBAR_INSET_WINDOWED;
    const contents = this.platform.webContents;
    if (!isPlatformUrl(contents.getURL())) return;
    contents.executeJavaScript(topbarInsetScript(inset), true).catch(() => undefined);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Window events
  // ───────────────────────────────────────────────────────────────────────────

  private wireWindowEvents(): void {
    const win = this.window;
    win.on("resize", () => this.layout());
    win.on("enter-full-screen", () => { this.patch({ isFullScreen: true }); this.layout(); this.applyTopbarInset(); });
    win.on("leave-full-screen", () => { this.patch({ isFullScreen: false }); this.layout(); this.applyTopbarInset(); });
    // On Windows every WebContentsView is its own HWND, so focus moving from
    // the ⋯ button to the dropdown fires a window "blur" followed by a "focus"
    // a few milliseconds later. Closing on the blur itself killed the menu the
    // instant it opened (the 1.1.5 "⋯ does nothing" bug). Wait, then close
    // only if the window really lost focus.
    win.on("blur", () => {
      setTimeout(() => {
        if (!this.destroyed && !win.isFocused()) this.closeMenu("window blur");
      }, MENU_BLUR_SETTLE_MS);
    });
    win.on("focus", () => { if (!this.state.menuOpen) this.activeView().webContents.focus(); });

    win.on("close", () => this.persist());
    win.on("closed", () => { this.destroyed = true; this.clearTicketTimer(); });

    // Show only once the shell has something painted, so there is no white flash.
    this.welcome.webContents.once("did-finish-load", () => {
      if (!this.destroyed && !win.isVisible()) win.show();
    });
  }

  private activeView(): WebContentsView {
    return this.welcomeShown ? this.welcome : this.platform;
  }

  private persist(): void {
    if (this.destroyed) return;
    const isMaximized = this.window.isMaximized();
    writeWindowState({
      bounds: isMaximized ? readWindowState().bounds ?? this.window.getNormalBounds() : this.window.getNormalBounds(),
      isMaximized,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Platform view events: navigation policy, injection, failures
  // ───────────────────────────────────────────────────────────────────────────

  private wirePlatformEvents(): void {
    const contents = this.platform.webContents;

    // Links that ask for a new window: same-origin ones open in place, the rest
    // in the user's default browser. The desktop app never grows a second window.
    contents.setWindowOpenHandler(({ url }) => {
      if (isPlatformUrl(url)) this.navigateTo(url);
      else this.openExternally(url);
      return { action: "deny" };
    });

    // Top-level navigations started by the page (link clicks, location.assign).
    contents.on("will-navigate", (event, url) => {
      if (this.steer(url, "navigate")) event.preventDefault();
    });

    // Server redirects — this is how `/dashboard` resolves to the user's
    // workspace (steered to the AI Workspace) and how a signed-out session
    // shows itself (a redirect to /sign-in → the welcome screen).
    contents.on("will-redirect", (event, url) => {
      if (this.steer(url, "redirect")) event.preventDefault();
    });

    const onNavigated = (url: string) => {
      const location = parseDashboardUrl(url);
      if (location?.userId) this.lastKnownUserId = location.userId;
      // Safety net: anything that slipped past will-navigate / will-redirect.
      if (this.steer(url, "late")) { contents.stop(); return; }
      if (location && this.welcomeShown) this.hideWelcome();
    };
    contents.on("did-navigate", (_event, url) => {
      this.lastAttemptedUrl = url;
      if (this.welcomeShown) log.info("platform navigated while signed out:", url.replace(/__clerk_ticket=[^&]+/, "__clerk_ticket=…"));
      onNavigated(url);
    });
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => { if (isMainFrame) onNavigated(url); });

    contents.on("page-title-updated", (_event, title) => {
      const clean = title.trim();
      this.window.setTitle(clean ? `${clean} — FinCraftly` : "FinCraftly");
    });

    // Reshape the platform: sidebar → titlebar menu. Every document load.
    contents.on("dom-ready", () => {
      if (!isPlatformUrl(contents.getURL())) return;
      contents.insertCSS(PLATFORM_CSS, { cssOrigin: "user" }).catch((error) => log.warn("insertCSS", error));
      contents.executeJavaScript(PLATFORM_JS, true).catch((error) => log.warn("inject", error));
      this.applyTopbarInset();
    });

    contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === ERR_ABORTED) return;
      log.warn("did-fail-load", errorCode, errorDescription, validatedUrl);
      this.lastAttemptedUrl = validatedUrl || this.lastAttemptedUrl;
      this.showOfflinePage(errorDescription);
    });

    contents.on("render-process-gone", (_event, details) => {
      log.error("platform renderer gone", details);
      if (details.reason !== "clean-exit" && !this.destroyed) {
        contents.loadURL(this.lastAttemptedUrl).catch((error) => log.warn("reload after crash", error));
      }
    });

    contents.on("unresponsive", () => log.warn("platform renderer unresponsive"));
    contents.on("responsive", () => log.info("platform renderer responsive again"));

    // Any click into the page dismisses the dropdown.
    contents.on("focus", () => this.closeMenu("platform focused"));

    this.wireShortcuts(contents);
    if (IS_DEV && process.env.FINCRAFTLY_DEVTOOLS === "1") contents.openDevTools({ mode: "detach" });
  }

  /**
   * THE navigation policy, applied to every URL the platform view is about to
   * show. Returns true when the shell took over (the caller must cancel the
   * navigation), false to let it through untouched.
   *
   *   • external schemes and other hosts → the default browser;
   *   • the platform's sign-in / sign-up pages → the welcome screen
   *     (unless it is our own ticket completing);
   *   • a dashboard view this app does not show → the AI Workspace.
   */
  private steer(url: string, source: "navigate" | "redirect" | "late" = "navigate"): boolean {
    if (url.startsWith("file:") || url === "about:blank") return false;
    if (isExternalScheme(url) || !isPlatformUrl(url)) {
      // A hop in the platform's own sign-in (Clerk's session handshake, an
      // auth provider that returns to fincraftly.com) stays in the app: it is
      // the app's session that needs the result. See PLATFORM_AUTH_HOST_PATTERNS.
      if (isPlatformAuthHop(url)) {
        log.info(`auth hop kept in-app (${source}):`, safeHost(url));
        return false;
      }
      log.info(`off-platform ${source} → browser:`, safeHost(url));
      this.openExternally(url);
      // If that was the very first thing this window tried to show, nothing is
      // on screen now. Never leave a blank window: show the welcome screen, and
      // let the platform be retried from there.
      if (!this.welcomeShown && !this.hasPlatformPage()) this.showWelcome("idle");
      return true;
    }
    if (isSignedOutUrl(url)) {
      this.showWelcome(this.pendingAuthState ? "waiting" : "idle");
      return true;
    }
    const rewritten = rewriteForDesktop(url);
    if (rewritten && rewritten !== url) {
      this.navigateTo(rewritten);
      return true;
    }
    return false;
  }

  /** True while the platform view has an http(s) document on screen. */
  private hasPlatformPage(): boolean {
    const current = this.platform.webContents.getURL();
    return /^https?:/i.test(current);
  }

  private openExternally(url: string): void {
    if (!/^(https?:|mailto:|tel:|sms:)/i.test(url)) return;
    shell.openExternal(url).catch((error) => log.warn("openExternal", error));
  }

  private showOfflinePage(reason: string): void {
    const file = join(__dirname, "../renderer/offline.html");
    const query = { reason, retry: this.lastAttemptedUrl, theme: this.state.theme };
    this.platform.webContents.loadFile(file, { query }).catch((error) => log.error("offline page", error));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Browser sign-in hand-off
  // ───────────────────────────────────────────────────────────────────────────

  private showWelcome(phase: AuthPhase, error = ""): void {
    if (this.destroyed) return;
    this.closeMenu();
    if (!this.welcomeShown) {
      this.welcomeShown = true;
      this.applyTheme("dark");
      this.welcome.setVisible(true);
      this.menuButton.setVisible(false);
      // Stop whatever the platform view was doing; it is off-screen now.
      this.platform.webContents.stop();
    }
    this.patch({ authPhase: phase, authError: error });
    this.welcome.webContents.focus();
  }

  private hideWelcome(): void {
    this.clearTicketTimer();
    if (!this.welcomeShown) return;
    this.welcomeShown = false;
    this.welcome.setVisible(false);
    this.menuButton.setVisible(true);
    this.patch({ authPhase: "idle", authError: "" });
  }

  /** Opens /desktop/sign-in in the default browser with a fresh nonce. */
  private startBrowserSignIn(): void {
    this.pendingAuthState = randomBytes(16).toString("hex");
    this.lastTicket = null;
    this.clearTicketTimer();
    this.showWelcome("waiting");
    const url = desktopSignInUrl(this.pendingAuthState);
    log.info("browser sign-in started");
    shell.openExternal(url).catch((error) => {
      log.warn("openExternal sign-in", error);
      this.showWelcome("error", "Could not open your browser. Open it yourself and go to fincraftly.com/desktop/sign-in.");
    });
  }

  private cancelBrowserSignIn(): void {
    this.pendingAuthState = null;
    this.clearTicketTimer();
    this.showWelcome("idle");
  }

  /** `fincraftly://auth?ticket=…&state=…` — the browser handing the session over. */
  private completeBrowserSignIn(ticket: string, state: string): void {
    if (!ticket) {
      this.showWelcome("error", "The sign-in link was incomplete. Please try again.");
      return;
    }
    // The browser page auto-launches the link AND has an "Open FinCraftly"
    // button, and Chrome may add its own "open app?" prompt — the same ticket
    // can easily arrive two or three times. Only the first copy counts.
    if (ticket === this.lastTicket) {
      log.info("sign-in ticket received again; already handling it");
      this.focus();
      return;
    }
    if (this.pendingAuthState && state && state !== this.pendingAuthState) {
      // A ticket from an older tab (the person pressed "Try again" and then
      // used the first tab). The ticket itself is single-use, bound to their
      // own account and two minutes old at most, so it is still theirs — take
      // it rather than send them round the loop again.
      log.info("sign-in ticket from an earlier tab; accepting");
    }
    this.lastTicket = ticket;
    this.pendingAuthState = null;
    this.showWelcome("completing");

    // If Clerk cannot consume the ticket (expired, already used) the platform
    // would show its sign-in form; we never show that in-app, so time-box it.
    this.clearTicketTimer();
    this.ticketTimer = setTimeout(() => {
      if (this.welcomeShown && this.state.authPhase === "completing") {
        this.lastTicket = null;
        this.showWelcome("error", "The sign-in link expired before it could be used. Please try again.");
      }
    }, TICKET_COMPLETION_TIMEOUT_MS);

    log.info("sign-in ticket accepted; completing on the platform");
    this.navigateTo(signInUrl(ticket));
  }

  private clearTicketTimer(): void {
    if (this.ticketTimer) { clearTimeout(this.ticketTimer); this.ticketTimer = null; }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Keyboard shortcuts (work from any view)
  // ───────────────────────────────────────────────────────────────────────────

  private wireShortcuts(contents: WebContents): void {
    contents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const key = input.key.toLowerCase();
      const ctrl = input.control || input.meta;

      if (key === "escape" && this.state.menuOpen) { this.closeMenu(); event.preventDefault(); return; }
      if (key === "f5" || (ctrl && key === "r")) { this.reload(); event.preventDefault(); return; }
      if (key === "f11") { this.window.setFullScreen(!this.window.isFullScreen()); event.preventDefault(); return; }
      if (ctrl && (key === "=" || key === "+")) { this.zoom(+1); event.preventDefault(); return; }
      if (ctrl && key === "-") { this.zoom(-1); event.preventDefault(); return; }
      if (ctrl && key === "0") { this.zoom(0); event.preventDefault(); return; }
      if (IS_DEV && ctrl && input.shift && key === "i") { this.platform.webContents.toggleDevTools(); event.preventDefault(); }
    });
  }

  private zoom(direction: -1 | 0 | 1): void {
    const contents = this.platform.webContents;
    if (direction === 0) { contents.setZoomLevel(0); return; }
    const next = Math.max(-3, Math.min(3, contents.getZoomLevel() + direction * 0.5));
    contents.setZoomLevel(next);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // IPC from the shell renderers
  // ───────────────────────────────────────────────────────────────────────────

  private wireIpc(): void {
    const ownSenders = new Set([this.menuButton.webContents.id, this.menu.webContents.id, this.welcome.webContents.id]);
    const guard = (handler: (event: IpcMainEvent, ...args: unknown[]) => void) =>
      (event: IpcMainEvent, ...args: unknown[]) => {
        if (this.destroyed || !ownSenders.has(event.sender.id)) return;
        handler(event, ...args);
      };

    ipcMain.on(IPC.menuToggle, guard(() => this.toggleMenu()));
    ipcMain.on(IPC.menuClose, guard(() => this.closeMenu()));
    ipcMain.on(IPC.menuAction, guard((_event, id) => { if (typeof id === "string") this.runMenuAction(id); }));
    ipcMain.on(IPC.signInStart, guard(() => this.startBrowserSignIn()));
    ipcMain.on(IPC.signInCancel, guard(() => this.cancelBrowserSignIn()));
    ipcMain.on(IPC.rendererReady, guard((event) => event.sender.send(IPC.stateChanged, this.state)));

    // From the platform preload (sender = platform view only).
    ipcMain.on(IPC.platformTheme, (event, theme: unknown) => {
      if (event.sender.id !== this.platform.webContents.id) return;
      if (theme === "dark" || theme === "light") this.applyTheme(theme);
    });

    // The dropdown closes whenever it loses focus (click anywhere else) —
    // unless focus is merely settling back onto it (see the window blur note).
    this.menu.webContents.on("blur", () => {
      setTimeout(() => {
        if (!this.destroyed && this.state.menuOpen && !this.menu.webContents.isFocused()) this.closeMenu("menu blur");
      }, MENU_BLUR_SETTLE_MS);
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // State
  // ───────────────────────────────────────────────────────────────────────────

  private patch(partial: Partial<ShellState>): void {
    if (this.destroyed) return;
    const next = { ...this.state, ...partial };
    const changed = (Object.keys(partial) as (keyof ShellState)[]).some((key) => next[key] !== this.state[key]);
    if (!changed) return;
    this.state = next;
    for (const view of [this.menuButton, this.menu, this.welcome]) {
      if (!view.webContents.isDestroyed()) view.webContents.send(IPC.stateChanged, this.state);
    }
  }

  private applyTheme(theme: ShellTheme): void {
    if (theme === this.state.theme) return;
    const tokens = THEME_TOKENS[theme];
    this.window.setBackgroundColor(tokens.background);
    this.window.setTitleBarOverlay({ color: tokens.background, symbolColor: tokens.symbol, height: CAPTION_CONTROLS_HEIGHT });
    this.menuButton.setBackgroundColor(tokens.background);
    this.welcome.setBackgroundColor(tokens.background);
    this.menu.setBackgroundColor(tokens.surface);
    this.platform.setBackgroundColor(tokens.background);
    this.patch({ theme });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Menu
  // ───────────────────────────────────────────────────────────────────────────

  private toggleMenu(): void {
    log.info("menu toggle; open =", this.state.menuOpen);
    if (this.state.menuOpen) { this.closeMenu("toggle"); return; }
    // The click on ⋯ blurs an open menu (closing it) a few ms before this
    // arrives; without the guard the same click would immediately reopen it.
    if (Date.now() - this.menuClosedAt < MENU_REOPEN_GUARD_MS) return;
    this.openMenu();
  }

  private openMenu(): void {
    if (this.destroyed || this.state.menuOpen || this.welcomeShown) return;
    this.layout();
    this.menu.setVisible(true);
    this.patch({ menuOpen: true });
    this.menu.webContents.focus();
  }

  private closeMenu(reason = "request"): void {
    if (this.destroyed || !this.state.menuOpen) return;
    log.info("menu closed:", reason);
    this.menu.setVisible(false);
    this.menuClosedAt = Date.now();
    this.patch({ menuOpen: false });
  }

  private runMenuAction(id: string): void {
    this.closeMenu();
    const item = SHELL_MENU.find((entry): entry is ShellMenuItem => !("separator" in entry) && entry.id === id);
    if (item?.view) { this.openView(item.view); return; }

    switch (id) {
      case "reload": this.reload(); break;
      case "open-in-browser": {
        const current = this.platform.webContents.getURL();
        this.openExternally(isPlatformUrl(current) ? current : platformOrigin());
        break;
      }
      case "about": this.showAbout(); break;
      case "sign-out": void this.signOut(); break;
      default: log.warn("unknown menu action", id);
    }
  }

  private showAbout(): void {
    void dialog.showMessageBox(this.window, {
      type: "info",
      title: "About FinCraftly",
      message: "FinCraftly for Windows",
      detail: `Version ${app.getVersion()}\nConnected to ${platformOrigin()}\n\n© ${new Date().getFullYear()} FinCraftly. All rights reserved.`,
      buttons: ["OK"],
      noLink: true,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Navigation
  // ───────────────────────────────────────────────────────────────────────────

  private navigateTo(url: string): void {
    if (this.destroyed) return;
    this.lastAttemptedUrl = url;
    this.platform.webContents.loadURL(url).catch((error: Error & { errno?: number }) => {
      // Aborted / failed loads are what a steered navigation looks like from
      // the outside (we cancelled its redirect on purpose); anything else is news.
      if (error?.errno !== ERR_ABORTED && error?.errno !== ERR_FAILED) log.warn("navigate", url, error);
    });
  }

  /**
   * Opens a platform view. Prefers the platform's own in-page navigation bus
   * (`window.FinCraftlyUI.navigateToView`, no reload, instant); falls back to a
   * full URL load when the page is not the dashboard (offline, …).
   */
  private openView(view: string): void {
    const contents = this.platform.webContents;
    const onDashboard = parseDashboardUrl(contents.getURL()) !== null;

    const fallback = () => {
      if (this.lastKnownUserId) this.navigateTo(dashboardUrl(this.lastKnownUserId, view));
      else this.navigateTo(entryUrl());
    };

    if (!onDashboard) { fallback(); return; }

    contents
      .executeJavaScript(
        `(() => { const api = window.FinCraftlyUI; if (api && typeof api.navigateToView === "function") { api.navigateToView(${JSON.stringify(view)}); return true; } return false; })()`,
        true,
      )
      .then((handled: unknown) => { if (handled !== true) fallback(); })
      .catch(() => fallback());
  }

  private reload(): void {
    if (this.welcomeShown) { this.navigateTo(entryUrl()); return; }
    const contents = this.platform.webContents;
    if (contents.getURL().startsWith("file:")) this.navigateTo(this.lastAttemptedUrl);
    else contents.reload();
  }

  /** Signs out of Clerk in-page when possible, wipes the session, shows the welcome screen. */
  private async signOut(): Promise<void> {
    const contents = this.platform.webContents;
    try {
      await contents.executeJavaScript(
        `(async () => { try { const clerk = window.Clerk; if (clerk && typeof clerk.signOut === "function") { await clerk.signOut(); } } catch {} return true; })()`,
        true,
      );
    } catch (error) {
      log.warn("clerk signOut", error);
    }
    try {
      await clearPlatformSession();
    } catch (error) {
      log.warn("clear session", error);
    }
    this.lastKnownUserId = null;
    this.pendingAuthState = null;
    this.lastTicket = null;
    this.showWelcome("idle");
    // Park the platform view on a blank page so nothing signed-in lingers.
    this.platform.webContents.loadURL("about:blank").catch(() => undefined);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public helpers used by main.ts
  // ───────────────────────────────────────────────────────────────────────────

  focus(): void {
    if (this.destroyed) return;
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }

  /**
   * Handles `fincraftly://…` deep links:
   *   fincraftly://auth?ticket=…&state=…   → browser sign-in hand-off
   *   fincraftly://<view>                   → open that platform view
   */
  openDeepLink(target: string): void {
    log.info("deep link", target.replace(/ticket=[^&]+/, "ticket=…"));
    this.focus();
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return;
    }
    const host = parsed.hostname;
    if (host.toLowerCase() === "auth") {
      this.completeBrowserSignIn(parsed.searchParams.get("ticket") ?? "", parsed.searchParams.get("state") ?? "");
      return;
    }
    const view = host || parsed.pathname.replace(/^\/+|\/+$/g, "");
    if (view && (!ALLOWED_VIEWS || ALLOWED_VIEWS.has(view)) && !this.welcomeShown) this.openView(view);
  }
}
