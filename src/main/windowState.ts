// =============================================================================
// src/main/windowState.ts
// -----------------------------------------------------------------------------
// Remembers the window's size, position and maximized state between launches
// (a JSON file in userData) and validates the saved bounds against the displays
// that exist NOW, so an unplugged monitor can never leave the window off-screen.
// =============================================================================

import { app, screen, type Rectangle } from "electron";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface PersistedWindowState {
  bounds?: Rectangle;
  isMaximized?: boolean;
}

const FILE_NAME = "window-state.json";
const DEFAULT_SIZE = { width: 1360, height: 860 };
const MIN_SIZE = { width: 900, height: 600 };

function statePath(): string {
  return join(app.getPath("userData"), FILE_NAME);
}

export function readWindowState(): PersistedWindowState {
  try {
    const raw = readFileSync(statePath(), "utf8");
    const parsed = JSON.parse(raw) as PersistedWindowState;
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

export function writeWindowState(state: PersistedWindowState): void {
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(statePath(), JSON.stringify(state), "utf8");
  } catch {
    // Persisting the window state is a convenience; never let it break launch.
  }
}

/**
 * Returns bounds that are guaranteed to be (mostly) visible on a current
 * display, falling back to a centred default on the primary display.
 */
export function resolveInitialBounds(saved?: Rectangle): Rectangle {
  const primary = screen.getPrimaryDisplay().workArea;

  if (saved && saved.width >= MIN_SIZE.width && saved.height >= MIN_SIZE.height) {
    const visibleOnSomeDisplay = screen.getAllDisplays().some((display) => {
      const area = display.workArea;
      const overlapX = Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x);
      const overlapY = Math.min(saved.y + saved.height, area.y + area.height) - Math.max(saved.y, area.y);
      // Require a meaningful slice of the window (title strip + some body) on screen.
      return overlapX >= 200 && overlapY >= 120;
    });
    if (visibleOnSomeDisplay) return saved;
  }

  const width = Math.min(DEFAULT_SIZE.width, primary.width);
  const height = Math.min(DEFAULT_SIZE.height, primary.height);
  return {
    x: Math.round(primary.x + (primary.width - width) / 2),
    y: Math.round(primary.y + (primary.height - height) / 2),
    width,
    height,
  };
}

export const WINDOW_MIN_SIZE = MIN_SIZE;
