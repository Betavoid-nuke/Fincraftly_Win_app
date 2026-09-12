// =============================================================================
// src/renderer/welcome.ts — the signed-out screen. Paints the auth phase from
// ShellState and forwards the two intents it has: start / cancel sign-in.
// =============================================================================

(() => {
  const shell = window.fincraftlyShell;
  const icons = window.ShellIcons;

  const byId = <T extends HTMLElement>(id: string): T => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`welcome: #${id} missing`);
    return element as T;
  };

  const root = byId<HTMLElement>("welcome");
  const error = byId<HTMLParagraphElement>("error");
  const version = byId<HTMLSpanElement>("version");

  byId<HTMLSpanElement>("sign-in-icon").innerHTML = icons.external;
  byId<HTMLSpanElement>("retry-icon").innerHTML = icons.refresh;

  byId<HTMLButtonElement>("sign-in").addEventListener("click", () => shell.startSignIn());
  byId<HTMLButtonElement>("reopen").addEventListener("click", () => shell.startSignIn());
  byId<HTMLButtonElement>("retry").addEventListener("click", () => shell.startSignIn());
  byId<HTMLButtonElement>("cancel").addEventListener("click", () => shell.cancelSignIn());

  shell.onState((state) => {
    document.documentElement.setAttribute("data-theme", state.theme);
    root.dataset.phase = state.authPhase;
    error.textContent = state.authError;
    version.textContent = `FinCraftly for Windows ${state.appVersion}`;
  });

  shell.ready();
})();
