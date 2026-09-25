// =============================================================================
// scripts/vendor-fincodes.mjs — put the FinCodes program into this app.
// -----------------------------------------------------------------------------
// Copies the built FinCodes bundle (fincodes.mjs + its pinned tree-sitter
// grammars) from the Fincraftly_FinCodes repo into vendor/fincodes/, writes its
// VERSION, and writes the two terminal shims. electron-builder then ships
// vendor/fincodes as resources/fincodes (outside the asar, so the app's own
// executable can run it as Node — see src/main/fincodes/host.ts).
//
//   FINCODES_DIST=<dir> node scripts/vendor-fincodes.mjs
//   default dir: ../Fincraftly_FinCodes/packages/daemon/dist (run `npm run build` there first)
//
// vendor/ is not committed: this public repo ships the built program in the
// installer, not in git.
// =============================================================================

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const source = resolve(process.env.FINCODES_DIST || "../Fincraftly_FinCodes/packages/daemon/dist");
const target = resolve("vendor/fincodes");
if (!existsSync(join(source, "fincodes.mjs"))) {
  console.error(`No FinCodes build at ${source}. Build it first (npm run build in Fincraftly_FinCodes) or set FINCODES_DIST.`);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
mkdirSync(join(target, "bin"), { recursive: true });

copyFileSync(join(source, "fincodes.mjs"), join(target, "fincodes.mjs"));
// The pinned grammars live in dist/grammars; FinCodes verifies their hashes at every start.
mkdirSync(join(target, "grammars"), { recursive: true });
const grammars = readdirSync(join(source, "grammars")).filter((name) => name.endsWith(".wasm") || name.endsWith(".json"));
for (const name of grammars) copyFileSync(join(source, "grammars", name), join(target, "grammars", name));
if (!grammars.includes("tree-sitter.wasm")) { console.error("The FinCodes build has no grammars/tree-sitter.wasm"); process.exit(1); }
const files = ["fincodes.mjs", ...grammars.map((name) => `grammars/${name}`)];

const version = execFileSync(process.execPath, [join(target, "fincodes.mjs"), "version"], { encoding: "utf8", env: { ...process.env, FINCODES_HOME: join(target, ".probe") } }).trim();
rmSync(join(target, ".probe"), { recursive: true, force: true });
if (!/^\d+\.\d+\.\d+/.test(version)) { console.error(`Unexpected version output: ${version}`); process.exit(1); }
writeFileSync(join(target, "VERSION"), `${version}\n`);
// The app checks this hash before it ever starts the bundled program (src/main/fincodes/host.ts):
// the copy under resources\ sits outside the asar, so it is verified from inside it.
writeFileSync(join(target, "SHA256"), `${createHash("sha256").update(readFileSync(join(target, "fincodes.mjs"))).digest("hex")}\n`);

// Terminal shims: run the bundled FinCodes with the app's executable as Node. CRLF — they are .cmd files.
// resources\fincodes\bin\ → ..\..\.. is the install folder that holds FinCraftly.exe.
const shim = [
  "@echo off",
  "setlocal",
  "set \"ELECTRON_RUN_AS_NODE=1\"",
  "set \"FINCODES_HOST=app\"",
  "\"%~dp0..\\..\\..\\FinCraftly.exe\" \"%~dp0..\\fincodes.mjs\" %*",
  "exit /b %ERRORLEVEL%",
  "",
].join("\r\n");
writeFileSync(join(target, "bin", "fincodes.cmd"), shim);
writeFileSync(join(target, "bin", "fcode.cmd"), shim);
// Used by the uninstaller (build/installer.nsh → customUnInstall): take this bin folder back off the
// user's Path. Registry read with DoNotExpandEnvironmentNames so an expandable Path stays expandable.
writeFileSync(join(target, "bin", "remove-path.ps1"), [
  "$bin = Split-Path -Parent $MyInvocation.MyCommand.Path",
  "$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)",
  "if ($key) {",
  "  $path = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)",
  "  $keep = @($path -split ';' | Where-Object { $_ -ne '' -and $_.TrimEnd('\\') -ine $bin.TrimEnd('\\') })",
  "  $key.SetValue('Path', ($keep -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)",
  "  [Environment]::SetEnvironmentVariable('FINCODES_PATH_BROADCAST', '1', 'User')",
  "  [Environment]::SetEnvironmentVariable('FINCODES_PATH_BROADCAST', $null, 'User')",
  "}",
  "",
].join("\r\n"));

console.log(`vendor/fincodes: FinCodes ${version} · ${files.length} files + bin/fincodes.cmd, bin/fcode.cmd`);
