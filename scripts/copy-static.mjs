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
