// =============================================================================
// src/renderer/menu.ts
// -----------------------------------------------------------------------------
// Renders the ⋯ dropdown from SHELL_MENU (delivered through the bridge) and
// supports full keyboard navigation. Row heights MUST match the constants in
// src/shared/config.ts — the main process sizes this view from them.
// =============================================================================

(() => {
  const shell = window.fincraftlyShell;
  const icons = window.ShellIcons;
  const panel = document.getElementById("panel");
  if (!panel) throw new Error("menu: #panel missing");

  const buttons: HTMLButtonElement[] = [];

  for (const entry of shell.menu) {
    if ("separator" in entry) {
      const rule = document.createElement("div");
      rule.className = "separator";
      rule.setAttribute("role", "separator");
      panel.appendChild(rule);
      continue;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "item";
    if (entry.hint) button.classList.add("with-hint");
    if (entry.primary) button.classList.add("primary");
    if (entry.danger) button.classList.add("danger");
    button.setAttribute("role", "menuitem");
    button.dataset.id = entry.id;

    const icon = document.createElement("span");
    icon.className = "icon";
    icon.innerHTML = icons[entry.icon] ?? "";

    const text = document.createElement("span");
    text.className = "text";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = entry.label;
    text.appendChild(label);
    if (entry.hint) {
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = entry.hint;
      text.appendChild(hint);
    }

    button.append(icon, text);
    button.addEventListener("click", () => shell.runMenuAction(entry.id));
    panel.appendChild(button);
    buttons.push(button);
  }

  // Keyboard: arrows move, Home/End jump, Enter/Space activate, Escape closes.
  const focusIndex = (index: number) => {
    if (buttons.length === 0) return;
    const wrapped = (index + buttons.length) % buttons.length;
    buttons[wrapped].focus();
  };

  document.addEventListener("keydown", (event) => {
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); focusIndex(current + 1); break;
      case "ArrowUp": event.preventDefault(); focusIndex(current - 1); break;
      case "Home": event.preventDefault(); focusIndex(0); break;
      case "End": event.preventDefault(); focusIndex(buttons.length - 1); break;
      case "Escape": event.preventDefault(); shell.closeMenu(); break;
      case "Tab": event.preventDefault(); focusIndex(current + (event.shiftKey ? -1 : 1)); break;
      default: break;
    }
  });

  shell.onState((state) => {
    document.documentElement.setAttribute("data-theme", state.theme);
    if (state.menuOpen) {
      // Reset focus to the top each time the panel opens.
      window.setTimeout(() => focusIndex(0), 0);
    }
  });

  shell.ready();
})();
