// =============================================================================
// src/main/fincodes/terminal.ts
// -----------------------------------------------------------------------------
// The `fincodes` (and `fcode`) terminal command, for people who like a terminal.
// The installer ships two tiny .cmd files in resources\fincodes\bin that run the
// bundled FinCodes with the app's own executable as Node; this puts that folder
// on the CURRENT USER's Path once (no admin rights, nothing machine-wide). New
// terminals see it; the uninstaller takes it off again (build/installer.nsh).
// =============================================================================

import { app } from "electron";
import log from "electron-log/main";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { bundleDir } from "./host";

function powershell(script: string, env: Record<string, string>): Promise<string> {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { windowsHide: true, timeout: 20_000, env: { ...process.env, ...env } }, (error, stdout) => {
      if (error) reject(error); else resolve(String(stdout).trim());
    });
  });
}

/**
 * Adds $env:FINCODES_BIN to the user's Path. Read and written through the registry so an
 * expandable Path (%USERPROFILE%\… entries) stays expandable, then one no-op environment write
 * broadcasts the change so new terminals see it. The folder comes in through the environment,
 * never spliced into the script text.
 */
const ADD_TO_USER_PATH = [
  "$bin = $env:FINCODES_BIN",
  "$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)",
  "$path = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)",
  "$parts = @($path -split ';' | Where-Object { $_ -ne '' })",
  "if ($parts | Where-Object { $_.TrimEnd('\\') -ieq $bin.TrimEnd('\\') }) { 'present' } else {",
  "  $key.SetValue('Path', (($parts + $bin) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)",
  "  [Environment]::SetEnvironmentVariable('FINCODES_PATH_BROADCAST', '1', 'User')",
  "  [Environment]::SetEnvironmentVariable('FINCODES_PATH_BROADCAST', $null, 'User')",
  "  'added' }",
].join("\n");

export async function ensureTerminalCommand(): Promise<void> {
  if (!app.isPackaged || process.platform !== "win32") return;
  const bin = join(bundleDir(), "bin");
  if (!existsSync(join(bin, "fincodes.cmd"))) return;
  try {
    const result = await powershell(ADD_TO_USER_PATH, { FINCODES_BIN: bin });
    if (result.endsWith("added")) log.info("terminal command: added", bin, "to the user Path");
  } catch (error) {
    log.warn("terminal command: could not update the user Path", error);
  }
}
