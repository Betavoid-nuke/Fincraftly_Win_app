// =============================================================================
// src/renderer/menubutton.ts — paints the ⋯ button and forwards its click.
// =============================================================================

(() => {
  const shell = window.fincraftlyShell;
  const button = document.getElementById("menu") as HTMLButtonElement | null;
  if (!button) throw new Error("menubutton: #menu missing");

  button.innerHTML = window.ShellIcons.more;
  button.addEventListener("click", () => shell.toggleMenu());

  shell.onState((state) => {
    document.documentElement.setAttribute("data-theme", state.theme);
    button.setAttribute("aria-expanded", String(state.menuOpen));
  });

  shell.ready();
})();
