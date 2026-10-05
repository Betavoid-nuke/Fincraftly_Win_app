// =============================================================================
// src/main/fincodes/daemonClient.ts
// -----------------------------------------------------------------------------
// A tiny JSON-RPC client for the FinCodes daemon's LOCAL endpoint — the same one
// the `fincodes` terminal command uses. Never TCP: a per-user named pipe on
// Windows, a 0600 unix socket elsewhere (only used by the Linux smoke test).
//
// Every request carries the daemon's rotating token from ~/.fincodes/ipc.token,
// read fresh on each call (the daemon mints a new one each time it starts).
// This file mirrors packages/daemon/src/paths.ts → ipcEndpoint() and daemon/ipc.ts
// in the Fincraftly_FinCodes repo; keep the two in step.
// =============================================================================

import { createConnection, type Socket } from "node:net";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

export function fincodesHome(): string {
  return process.env.FINCODES_HOME || join(homedir(), ".fincodes");
}

/**
 * On Windows the daemon picks a new, unguessable pipe name at every start and publishes it in
 * ~/.fincodes/run/pipe (this user's profile only). A predictable name could be created first by
 * another user on the same PC, who would then receive our token and answer as FinCodes.
 */
const PIPE_PATTERN = /^\\\\\.\\pipe\\fincodes-[A-Za-z0-9_.-]{8,120}$/;

export function ipcEndpoint(): string {
  if (process.env.FINCODES_IPC) return process.env.FINCODES_IPC;
  if (process.platform === "win32") {
    try {
      const name = readFileSync(join(fincodesHome(), "run", "pipe"), "utf8").trim();
      if (PIPE_PATTERN.test(name)) return name;
    } catch { /* not running */ }
    return `\\\\.\\pipe\\fincodes-none-${randomBytes(8).toString("hex")}`;
  }
  return process.env.XDG_RUNTIME_DIR && !process.env.FINCODES_HOME
    ? join(process.env.XDG_RUNTIME_DIR, "fincodes.sock")
    : join(fincodesHome(), "run", "fincodes.sock");
}

function readToken(): string {
  try { return readFileSync(join(fincodesHome(), "ipc.token"), "utf8").trim(); } catch { return ""; }
}

export class DaemonError extends Error {}

type Waiter = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export class DaemonClient {
  private socket: Socket | null = null;
  private connecting: Promise<void> | null = null;
  private buffer = "";
  private nextId = 1;
  private readonly waiting = new Map<number, Waiter>();
  /** Notifications the daemon pushes (after events/subscribe). */
  onNotification: (method: string, params: Record<string, unknown>) => void = () => undefined;
  onClose: () => void = () => undefined;

  get connected(): boolean { return !!this.socket && !this.socket.destroyed; }

  connect(timeoutMs = 2_000): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = createConnection(ipcEndpoint());
      const timer = setTimeout(() => { socket.destroy(); reject(new DaemonError("FinCodes is not running")); }, timeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        this.socket = socket;
        socket.setEncoding("utf8");
        socket.on("data", (chunk: string) => this.receive(chunk));
        socket.on("close", () => {
          this.socket = null;
          for (const [id, waiter] of this.waiting) { clearTimeout(waiter.timer); waiter.reject(new DaemonError("FinCodes closed the connection")); this.waiting.delete(id); }
          this.onClose();
        });
        resolve();
      });
      socket.once("error", (error) => { clearTimeout(timer); reject(new DaemonError(error.message)); });
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 8 * 1024 * 1024) { this.socket?.destroy(); this.buffer = ""; return; }
    let index: number;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      let message: { id?: number | null; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } };
      try { message = JSON.parse(line); } catch { continue; }
      if (message.method && (message.id === undefined || message.id === null)) { this.onNotification(message.method, message.params || {}); continue; }
      if (typeof message.id !== "number") continue;
      const waiter = this.waiting.get(message.id);
      if (!waiter) continue;
      this.waiting.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new DaemonError(String(message.error.message || "FinCodes error")));
      else waiter.resolve(message.result);
    }
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<T> {
    await this.connect();
    const socket = this.socket;
    if (!socket) throw new DaemonError("FinCodes is not running");
    const id = this.nextId++;
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new DaemonError(`${method} timed out`)); }, timeoutMs);
      this.waiting.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      socket.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, surface: "app" }, auth: readToken() })}\n`);
    });
  }

  close(): void { this.socket?.destroy(); this.socket = null; }
}
