// =============================================================================
// src/main/platformUrls.ts
// -----------------------------------------------------------------------------
// URL helpers: which origin the app wraps, how dashboard URLs decompose, and
// the routing rule that keeps the desktop app on the AI Workspace.
// =============================================================================

import {
  ALLOWED_VIEWS,
  DASHBOARD_ENTRY_PATH,
  DESKTOP_SIGN_IN_PATH,
  DASHBOARD_PATH_PATTERN,
  DEFAULT_PLATFORM_ORIGIN,
  HOME_VIEW,
  LEGACY_DASHBOARD_PATH_PATTERN,
  PLATFORM_AUTH_HOST_PATTERNS,
} from "../shared/config";

let cachedOrigin: string | null = null;

/** The platform origin, e.g. `https://fincraftly.com` (no trailing slash). */
export function platformOrigin(): string {
  if (cachedOrigin) return cachedOrigin;
  const fromEnv = process.env.FINCRAFTLY_ORIGIN?.trim();
  let origin = DEFAULT_PLATFORM_ORIGIN;
  if (fromEnv) {
    try {
      origin = new URL(fromEnv).origin;
    } catch {
      origin = DEFAULT_PLATFORM_ORIGIN;
    }
  }
  cachedOrigin = origin;
  return origin;
}

export function isPlatformUrl(url: string): boolean {
  try {
    return new URL(url).origin === platformOrigin();
  } catch {
    return false;
  }
}

/** Query parameters auth providers use to say where to come back to. */
const RETURN_URL_PARAMS = ["redirect_url", "redirect_uri", "return_to", "returnTo", "after_sign_in_url"];

/**
 * True for a URL that is a hop in the platform's own sign-in flow on another
 * host: Clerk's frontend API (the session handshake) or any auth provider
 * redirect that carries a return address back to the platform. Such a URL
 * must load INSIDE the app — it comes straight back to fincraftly.com with
 * the session the app's own cookie jar needs. Everything else off-origin
 * belongs in the person's browser.
 */
export function isPlatformAuthHop(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (isPlatformUrl(url)) return false;
  if (PLATFORM_AUTH_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname))) return true;
  return RETURN_URL_PARAMS.some((name) => {
    const value = parsed.searchParams.get(name);
    return value !== null && isPlatformUrl(value);
  });
}

export interface DashboardLocation {
  userId: string;
  view: string;
}

/** Decomposes `/dashboard/{userId}/{view}` (or the legacy route) if `url` is one. */
export function parseDashboardUrl(url: string): DashboardLocation | null {
  if (!isPlatformUrl(url)) return null;
  const { pathname } = new URL(url);
  const match = DASHBOARD_PATH_PATTERN.exec(pathname);
  if (match) return { userId: decodeURIComponent(match[1]), view: decodeURIComponent(match[2]) };
  const legacy = LEGACY_DASHBOARD_PATH_PATTERN.exec(pathname);
  if (legacy) return { userId: "", view: decodeURIComponent(legacy[1]) };
  return null;
}

export function dashboardUrl(userId: string, view: string): string {
  return `${platformOrigin()}/dashboard/${encodeURIComponent(userId)}/${encodeURIComponent(view)}`;
}

/** Where the app starts: the platform resolves this to the signed-in workspace. */
export function entryUrl(): string {
  return `${platformOrigin()}${DASHBOARD_ENTRY_PATH}`;
}

/** The platform's sign-in page URL, optionally consuming a Clerk sign-in token. */
export function signInUrl(ticket?: string): string {
  const url = new URL("/sign-in", platformOrigin());
  if (ticket) {
    url.searchParams.set("__clerk_ticket", ticket);
    url.searchParams.set("redirect_url", DASHBOARD_ENTRY_PATH);
  }
  return url.toString();
}

/** The browser page that hands a signed-in session over to the app. */
export function desktopSignInUrl(state: string): string {
  const url = new URL(DESKTOP_SIGN_IN_PATH, platformOrigin());
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * True for the platform's own sign-in / sign-up pages — the signal that the
 * app has no session. A URL carrying `__clerk_ticket` is the hand-off
 * completing and is NOT treated as signed-out.
 */
export function isSignedOutUrl(url: string): boolean {
  if (!isPlatformUrl(url)) return false;
  const parsed = new URL(url);
  if (parsed.searchParams.has("__clerk_ticket")) return false;
  return /^\/(sign-in|sign-up)(\/|$)/.test(parsed.pathname);
}

/**
 * THE routing rule. Given a URL the platform is about to show, returns the URL
 * the desktop app should show instead — or `null` when the URL is fine as is.
 *
 * Only dashboard URLs whose view slug is not one of this app's views are
 * rewritten (to the AI Workspace for the same user). Sign-in, OAuth providers,
 * marketing pages, the /dashboard resolver and everything else pass through.
 */
export function rewriteForDesktop(url: string): string | null {
  const location = parseDashboardUrl(url);
  if (!location) return null;
  // The legacy route carries no user id; the resolver will find it.
  if (!location.userId) return entryUrl();
  if (ALLOWED_VIEWS && !ALLOWED_VIEWS.has(location.view)) return dashboardUrl(location.userId, HOME_VIEW);
  return null;
}

/** External schemes the OS should handle rather than the app. */
export function isExternalScheme(url: string): boolean {
  return /^(mailto|tel|sms|ms-|whatsapp):/i.test(url);
}

