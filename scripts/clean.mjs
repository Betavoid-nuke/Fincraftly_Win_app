// Removes the compiled output so every build starts from a clean tree.
import { rmSync } from "node:fs";
import { resolve } from "node:path";

rmSync(resolve(process.cwd(), "dist"), { recursive: true, force: true });
