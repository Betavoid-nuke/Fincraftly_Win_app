// =============================================================================
// src/preload/shellPreload.ts
// -----------------------------------------------------------------------------
// Bridge for the shell's OWN renderers (the ⋯ button, the menu panel and the
// signed-out welcome screen). Exposes a small typed API — window controls, navigation, menu
// actions and a state subscription — and nothing else.
// =============================================================================

import { contextBridge, ipcRenderer } from "electron";
import { IPC, SHELL_MENU, THEME_TOKENS, type ShellState } from "../shared/config";

export interface ShellBridge {
  toggleMenu(): void;
  closeMenu(): void;
  runMenuAction(id: string): void;
  /** Opens the platform's sign-in page in the default browser and waits for the hand-off. */
  startSignIn(): void;
  cancelSignIn(): void;
  ready(): void;
  onState(listener: (state: ShellState) => void): () => void;
  readonly menu: typeof SHELL_MENU;
  readonly tokens: typeof THEME_TOKENS;
}

const bridge: ShellBridge = {
  toggleMenu: () => ipcRenderer.send(IPC.menuToggle),
  startSignIn: () => ipcRenderer.send(IPC.signInStart),
  cancelSignIn: () => ipcRenderer.send(IPC.signInCancel),
  closeMenu: () => ipcRenderer.send(IPC.menuClose),
  runMenuAction: (id) => ipcRenderer.send(IPC.menuAction, id),
  ready: () => ipcRenderer.send(IPC.rendererReady),
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: ShellState) => listener(state);
    ipcRenderer.on(IPC.stateChanged, handler);
    return () => ipcRenderer.removeListener(IPC.stateChanged, handler);
  },
  menu: SHELL_MENU,
  tokens: THEME_TOKENS,
};

contextBridge.exposeInMainWorld("fincraftlyShell", bridge);
