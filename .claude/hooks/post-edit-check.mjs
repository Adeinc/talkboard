#!/usr/bin/env node
// PostToolUse hook: after Claude edits a file, run a quick check and hand any
// errors straight back to Claude so it fixes them before moving on.
//
// Usage (from .claude/settings.json):
//   node .../post-edit-check.mjs ts "npm run typecheck"   -> runs the command when a .ts/.tsx file changes
//   node .../post-edit-check.mjs js [ignored/dir ...]      -> `node --check` on the edited server-side .js file
//
// Exit code 2 = "Claude, here's a problem" (stderr is shown to Claude).
// Exit code 0 = fine, or nothing to check.
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { relative, extname } from "node:path";

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}

const file = (input.tool_input || {}).file_path || "";
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const [mode, ...rest] = process.argv.slice(2);
const ext = extname(file).toLowerCase();
if (!file || !existsSync(file)) process.exit(0);

function fail(label, output) {
  const tail = String(output || "").slice(-3000);
  process.stderr.write(`${label} failed after editing ${relative(root, file)}:\n${tail}\nFix these before continuing.`);
  process.exit(2);
}

if (mode === "ts") {
  if (![".ts", ".tsx", ".mts", ".cts"].includes(ext)) process.exit(0);
  if (!existsSync(`${root}/node_modules`)) process.exit(0); // deps not installed yet: nothing useful to run
  const cmd = rest[0] || "npx tsc --noEmit";
  try {
    execSync(cmd, { cwd: root, stdio: "pipe", timeout: 170_000 });
  } catch (e) {
    fail(`Type-check (${cmd})`, `${e.stdout || ""}${e.stderr || ""}`);
  }
} else if (mode === "js") {
  if (![".js", ".mjs", ".cjs"].includes(ext)) process.exit(0);
  const rel = relative(root, file);
  if (rest.some((dir) => rel.startsWith(dir.replace(/\/?$/, "/")))) process.exit(0);
  try {
    execSync(`node --check ${JSON.stringify(file)}`, { stdio: "pipe", timeout: 30_000 });
  } catch (e) {
    fail("Syntax check (node --check)", `${e.stdout || ""}${e.stderr || ""}`);
  }
}
process.exit(0);
