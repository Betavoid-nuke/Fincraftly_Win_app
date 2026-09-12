# FinCraftly for Windows

The FinCraftly platform as an installable Windows app, scoped to the **AI Workspace**.

It is a native desktop shell (Electron) around the live platform at
`https://fincraftly.com`. Nothing from the platform is copied or forked: the
app signs in with the real Clerk session, talks to the real APIs, and is
always on the version that is deployed. What the shell adds is:

- a frameless window with the **Windows caption buttons** (minimize / maximize
  / close) drawn by the OS, the same treatment the Claude desktop app uses,
  recoloured live to the platform's light or dark theme;
- a **⋯ menu** beside the caption buttons with the shell's own actions — Open
  in browser / Reload / About / Sign out;
- the platform's **left sidebar**, restyled to the AI Workspace rail's language
  (near-black rail, grey section captions, neutral selection, uncoloured icons)
  with its collapse button in the topbar — all done by injected CSS, the web
  app is untouched;
- **no Hydra notch, no Desktop (OS-mode) toggle, no FinOS taskbar**: a plain
  Hydra button sits where the Desktop toggle was and opens the assistant;
- **AI Workspace first**: the app opens on `/platform/AIWS`, which the platform
  resolves straight to the signed-in user's AI Workspace; every other view is
  one sidebar click away. The AIWS console's own tabs (Agents, Approvals, Integrations,
  Information Bank) keep working — they live inside the console;
- sign-in hops that leave the platform's origin but come straight back — Clerk's
  session handshake on `clerk.fincraftly.com`, an auth provider carrying a
  `redirect_url` to fincraftly.com — load **inside** the app (they are what
  gives the app's own session its cookies); every other off-platform link
  opens in the default browser;
- a persistent session (stay signed in), a branded offline page with retry,
  window size/position memory, single-instance behaviour, `fincraftly://`
  deep links, and silent auto-updates once a feed is configured;
- a branded NSIS installer (`FinCraftly-Setup-<version>.exe`).

## Requirements

- Windows 10 / 11, x64
- Node.js 20+ and npm (for building only)

## Build the installer

```powershell
npm install
npm run dist
```

The installer lands in `release\FinCraftly-Setup-<version>.exe`. Run it, pick a
folder (or keep the default), and FinCraftly opens when it finishes. The app is
also in the Start menu and on the desktop.

`npm run dist:dir` builds the unpacked app (`release\win-unpacked\FinCraftly.exe`)
without an installer — handy for a quick look.

### Signing (recommended before public distribution)

Unsigned builds install fine but Windows SmartScreen shows a "more info"
prompt the first time. To sign, set `WIN_CSC_LINK` (path/base64 of a `.pfx`) and
`WIN_CSC_KEY_PASSWORD` before `npm run dist`, or configure Azure Trusted Signing
in `electron-builder.yml`.

### Auto-updates

Uncomment the `publish` block in `electron-builder.yml` and point it at a
static host. Upload the contents of `release/` (`latest.yml`, the installer and
its `.blockmap`) there after every `npm run dist`; installed apps pick the new
version up silently and apply it on the next launch.

## Run from source

```powershell
npm install
npm run dev              # against https://fincraftly.com
npm run dev:local        # against a local platform on http://localhost:3000
```

`FINCRAFTLY_DEV=1` (set by both scripts) enables DevTools (`Ctrl+Shift+I`) and
disables the updater. `FINCRAFTLY_ORIGIN` overrides the platform origin.

### Smoke test (no platform needed)

```powershell
node scripts/fake-platform.mjs                          # terminal 1
$env:FINCRAFTLY_SMOKE=1; npm run dev:local -- ; # terminal 2 (see below)
```

`scripts/fake-platform.mjs` is a 100-line stand-in for the platform (same URL
shapes, `data-theme`, sidebar hook, navigation bus). With `FINCRAFTLY_SMOKE=1`
and `FINCRAFTLY_ORIGIN=http://127.0.0.1:3999` the app drives itself through
open-menu → Settings → Home → theme toggle → Sign out and logs `SMOKE …` lines
with the result of each step (`%AppData%\FinCraftly\logs\main.log`).

## Keyboard

| Keys | Action |
| --- | --- |
| `Alt+←` / `Alt+→` | Back / forward |
| `Ctrl+R`, `F5` | Reload |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset |
| `F11` | Full screen |
| `Esc` | Close the ⋯ menu |

## How it is put together

```
src/
  shared/config.ts         platform origin, allowed views, the ⋯ menu, theme tokens, IPC names
  main/main.ts             app lifecycle, single instance, deep links
  main/shellWindow.ts      the window: titlebar view + platform view + menu view, all routing & state
  main/platformUrls.ts     URL rules — the AI-Workspace-only rewrite lives here
  main/platformSession.ts  persistent session, browser-like UA, desktop header, permissions
  main/platformInjection.ts the CSS that hides the platform sidebar (selectors are the platform's data-tour hooks)
  main/windowState.ts      remembers bounds / maximized / theme
  main/updater.ts          electron-updater, silent
  main/smoke.ts            dev-only scripted UI test
  preload/platformPreload.ts  sandboxed; reports <html data-theme> to the shell, exposes window.fincraftlyDesktop
  preload/shellPreload.ts     bridge for the shell's own pages
  renderer/                titlebar.html, menu.html, offline.html (+ css/ts, no framework)
build/                     icon.ico, installer sidebar/header art
electron-builder.yml       packaging + NSIS
```

The platform is reshaped by **hiding, never re-implementing**: one injected
stylesheet keyed on the platform's stable `data-tour` attributes. Navigation
between views uses the platform's own bus (`window.FinCraftlyUI.navigateToView`),
so switching to Settings is instant and does not reload the page; a full URL
load is the fallback when the page is not the dashboard (sign-in, offline).

## Changing what the app shows

- **Add / remove a menu row** → `SHELL_MENU` in `src/shared/config.ts`. A row
  with a `view` navigates to that platform view; add the view to
  `ALLOWED_VIEWS` too or the shell will bounce it back to the AI Workspace.
- **Point at another origin** → `DEFAULT_PLATFORM_ORIGIN` (or the
  `FINCRAFTLY_ORIGIN` env var for a one-off run).
- **Platform markup changed and the sidebar came back?** → the selectors in
  `src/main/platformInjection.ts`.
