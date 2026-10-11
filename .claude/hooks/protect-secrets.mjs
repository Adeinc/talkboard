#!/usr/bin/env node
// PreToolUse hook: stops Claude reading or writing files that hold real secrets
// (.env files, private keys, cloud service-account JSON).
// .env.example / .env.sample / .env.template stay allowed so Claude can see
// which variables exist without seeing their values.
//
// Bash checks are best-effort: they catch commands that name a secrets file
// (cat .env, source .env.local, cp x .env) but not ones that reach a file
// indirectly. Treat this as a seatbelt, not a vault.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0); // unreadable input: don't block work on a hook bug
}

const tool = input.tool_name || "";
const args = input.tool_input || {};

const ALLOWED = /^\.env\.(example|sample|template)$/i;
function isSecretFile(p) {
  const name = basename(String(p));
  if (ALLOWED.test(name)) return false;
  return (
    /^\.env(\..+)?$/i.test(name) ||
    /\.(pem|key|p12|pfx)$/i.test(name) ||
    /^service[-_]?account.*\.json$/i.test(name)
  );
}

let hit = null;
if (["Read", "Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool)) {
  const p = args.file_path || args.notebook_path || "";
  if (p && isSecretFile(p)) hit = p;
} else if (tool === "Grep" || tool === "Glob") {
  if (args.path && isSecretFile(args.path)) hit = args.path;
} else if (tool === "Bash") {
  const tokens = String(args.command || "").split(/[\s'"`;|&<>()=]+/);
  hit = tokens.find((t) => t && isSecretFile(t)) || null;
}

if (hit) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `Blocked: "${hit}" looks like a secrets file. Ask the owner to make this change by hand, ` +
          `or read .env.example to see which variables exist. ` +
          `(Rule lives in .claude/hooks/protect-secrets.mjs.)`,
      },
    })
  );
}
process.exit(0);
