import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const standaloneDir = join(".next", "standalone");

if (!existsSync(standaloneDir)) {
  throw new Error("Missing .next/standalone. Run next build with output: 'standalone' first.");
}

mkdirSync(join(standaloneDir, ".next"), { recursive: true });
cpSync(join(".next", "static"), join(standaloneDir, ".next", "static"), {
  recursive: true,
});
cpSync("public", join(standaloneDir, "public"), {
  recursive: true,
});
