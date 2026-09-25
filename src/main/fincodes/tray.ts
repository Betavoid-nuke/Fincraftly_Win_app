// =============================================================================
// src/main/fincodes/tray.ts
// -----------------------------------------------------------------------------
// FinCodes in the Windows notification area (FinCodes/11 §3): connection, what
// is being worked on, approvals waiting (with a toast for each new one — click
// it and the app opens Local Work at that card), and the four actions a person
// needs without opening the app: Open, Stop the current job, Pause FinCodes on
// this computer, Panic. "Quit FinCraftly" is the only way the app itself exits
// while FinCodes is connected (closing the window hides it to the tray).
// =============================================================================

import { app, Menu, Notification, Tray, dialog, nativeImage, type MenuItemConstructorOptions } from "electron";
import log from "electron-log/main";
import { join } from "node:path";
import { DaemonClient } from "./daemonClient";
import { finCodes, type DaemonStatus } from "./host";

export interface TrayHost {
  show(): void;
  /** Open a platform path in the app, e.g. /platform/LocalWork?approval=… */
  openPath(path: string): void;
  quit(): void;
}

export class FinCodesTray {
  private readonly tray: Tray;
  private readonly events = new DaemonClient();
  private status: DaemonStatus | null = null;
  private readonly notified = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly host: TrayHost) {
    this.tray = new Tray(nativeImage.createFromPath(join(__dirname, "../../renderer/assets/icon.png")).resize({ width: 16, height: 16 }));
    this.tray.setToolTip("FinCraftly");
    this.tray.on("click", () => this.host.show());
    this.events.onNotification = (method, params) => this.onEvent(method, params);
    this.events.onClose = () => { setTimeout(() => void this.subscribe(), 5_000); };
    this.rebuild();
    void this.subscribe();
    this.timer = setInterval(() => void this.refresh(), 15_000);
    void this.refresh();
  }

  get connected(): boolean { return !!this.status?.paired; }

  private async subscribe(): Promise<void> {
    try {
      if (!(await finCodes.ensureRunning())) return;
      await this.events.connect(2_000);
      await this.events.call("events/subscribe");
    } catch (error) {
      log.debug("fincodes tray: subscribe", error);
    }
  }

  private onEvent(method: string, params: Record<string, unknown>): void {
    const data = (params.data || {}) as Record<string, unknown>;
    if (method === "local/event" && params.type === "session" && data.approval) {
      const approval = data.approval as { approvalId?: string; render?: { title?: string } };
      const id = String(approval.approvalId || "");
      if (id && !this.notified.has(id) && Notification.isSupported()) {
        this.notified.add(id);
        const who = String((data.aie as { name?: string } | undefined)?.name || "An AI employee");
        const toast = new Notification({ title: `${who} needs your approval`, body: String(approval.render?.title || "A change is waiting for you."), silent: false });
        toast.on("click", () => this.host.openPath(`/platform/LocalWork?approval=${encodeURIComponent(id)}`));
        toast.show();
      }
    }
    // Tool-by-tool events are frequent; only a session or connection change can change the menu.
    if (params.type !== "event") void this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      this.status = await finCodes.client.call<DaemonStatus>("daemon/status", {}, 5_000);
    } catch {
      this.status = null;
    }
    this.rebuild();
  }

  private async act(method: string, params: Record<string, unknown> = {}): Promise<void> {
    try { await finCodes.call(method, params); } catch (error) { dialog.showErrorBox("FinCraftly", error instanceof Error ? error.message : String(error)); }
    void this.refresh();
  }

  private rebuild(): void {
    const status = this.status;
    const working = status?.sessions.find((session) => session.status === "running");
    const connected = status?.connection === "connected";
    const lines: MenuItemConstructorOptions[] = [
      { label: "FinCraftly", enabled: false },
      {
        label: !status ? "○ FinCodes not running" : !status.paired ? "○ This computer is not connected" : `${connected ? "●" : "○"} ${connected ? "Connected" : status.connection}${status.machine ? ` · ${status.machine.org}` : ""}`,
        enabled: false,
      },
      ...(working ? [{ label: `Working — ${working.aie.name}: ${working.todo.slice(0, 40)}`, click: () => this.host.openPath(`/platform/LocalWork?job=${encodeURIComponent(working.jobId)}`) }] : []),
      ...(status?.pendingApprovals ? [{ label: `${status.pendingApprovals} approval${status.pendingApprovals === 1 ? "" : "s"} waiting`, click: () => this.host.openPath("/platform/LocalWork") }] : []),
      { type: "separator" },
      { label: "Open FinCraftly", click: () => this.host.show() },
      { label: "Stop the current job", enabled: !!working, click: () => { if (working) void this.act("session/cancel", { sessionId: working.sessionId }); } },
      { label: "Pause FinCodes on this computer", enabled: !!status, click: () => void this.act("daemon/stop") },
      { type: "separator" },
      {
        label: "Panic — stop everything and disconnect",
        enabled: !!status?.paired,
        click: async () => {
          const answer = await dialog.showMessageBox({ type: "warning", buttons: ["Cancel", "Stop everything"], defaultId: 0, cancelId: 0, noLink: true, message: "Stop every job, disconnect this computer and forget its keys?", detail: "You can connect it again from Local Work." });
          if (answer.response === 1) await this.act("daemon/panic");
        },
      },
      { type: "separator" },
      { label: "Quit FinCraftly", click: () => this.host.quit() },
    ];
    this.tray.setContextMenu(Menu.buildFromTemplate(lines));
    this.tray.setToolTip(`FinCraftly${status?.pendingApprovals ? ` — ${status.pendingApprovals} approval(s) waiting` : ""}`);
    if (process.platform === "win32") app.setBadgeCount(status?.pendingApprovals || 0);
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.events.close();
    this.tray.destroy();
  }
}
