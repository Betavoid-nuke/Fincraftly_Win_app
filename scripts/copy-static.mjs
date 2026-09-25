// Copies the non-TypeScript renderer files (HTML, CSS, images) next to the
// compiled JavaScript so `dist/` is a complete, self-contained app tree.
import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const copies = [
  ["src/renderer", "dist/renderer"],
];

for (const [from, to] of copies) {
  const destination = resolve(root, to);
  mkdirSync(destination, { recursive: true });
  cpSync(resolve(root, from), destination, {
    recursive: true,
    // TypeScript already emitted the .js files for these; only copy assets.
    filter: (source) => !source.endsWith(".ts"),
  });
}

// The FinCodes bundle hash goes INSIDE the app (dist → asar); the bundle itself ships outside it.
import { copyFileSync, existsSync } from "node:fs";
const bundleHash = resolve(root, "vendor/fincodes/SHA256");
if (existsSync(bundleHash)) {
  mkdirSync(resolve(root, "dist/main/fincodes"), { recursive: true });
  copyFileSync(bundleHash, resolve(root, "dist/main/fincodes/bundle.sha256"));
}
