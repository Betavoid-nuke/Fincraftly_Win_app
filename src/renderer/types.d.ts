// Ambient types for the shell's own renderer scripts. They run as plain
// browser scripts (no bundler, no Node), talking to the main process only
// through the `fincraftlyShell` bridge that shellPreload.ts exposes.

import type { ShellBridge } from "../preload/shellPreload";

declare global {
  interface Window {
    fincraftlyShell: ShellBridge;
    /** Inline SVG markup by icon name — see shellIcons.ts. */
    ShellIcons: Record<string, string>;
  }
}

export {};
