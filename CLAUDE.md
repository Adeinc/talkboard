# TalkBoard — orientation for Claude Code

Mobile-first community forum with three sections (Community Development, Sport, Community History), accounts, photo uploads, reporting and a moderation panel. Full feature list in `README.md`.

## Facts that matter

- **Single Node process:** `server.js` (Express routes), `db.js` (SQLite via `sql.js`, stored in `talkboard.db`), `mailer.js` (Resend, or console output when no key is set). Frontend is `public/index.html` + `public/i18n.js`. No build step, no TypeScript, no tests.
- Passwords are hashed with scrypt. The **first account to register becomes admin**.
- 30-day auto-delete and the new-member posting wait are enforced server-side — keep them server-side.
- Uploads go to `uploads/`. Hosting needs a persistent disk or the database and photos are wiped on redeploy.

## Known risks (flagged, not yet fixed)

- **`talkboard.db` is committed to this public repository** and contains a real admin account (email, password hash and session token). Treat this as an owner decision: removing the file from Git does not remove it from history.
- There is no `.gitignore`, so `talkboard.db` and `uploads/` will keep being committed.
- Legacy accounts with no password can be claimed by whoever signs in first with that name — review before relying on it.

## Checks

`node --check server.js db.js mailer.js` (the post-edit hook runs this on each edited server file), then `npm start` and walk through sign-up → post → reply → report → moderate on a phone-sized screen.

## Standing rules (Monedela house standard)

These apply to every task in this repo. The owner is Ola (product owner, Monedela Ltd).

- **Truth mode.** When reporting back, keep these separate: what you inspected, what you changed, what you verified locally, what is confirmed live, and what is still blocked or depends on the owner. Never describe a local change, migration file, mock-up or unconnected integration as live.
- **Secrets.** Never read or write `.env*` files, private keys or service-account JSON — a hook in `.claude/hooks/protect-secrets.mjs` blocks this; use `.env.example` to see variable names. Never put a service-role key, secret key or webhook secret in browser or mobile code, or in a `NEXT_PUBLIC_` / `VITE_` / `EXPO_PUBLIC_` variable.
- **Verify before saying "done".** Run the check commands listed in this file and say which ones passed. A post-edit hook already runs a quick check after each edit; it does not replace the full check.
- **Production and data.** Before any migration, SQL, deploy or webhook change, confirm which project and environment you are connected to. Prefer a migration file (or a database branch) over changing production directly. Ask first before changing production data, deploying, spending money, exposing a service publicly or sending messages on the owner's behalf.
- **Bugs.** Trace the whole path (UI → logic → API/server → database → email/notifications → live config) instead of patching the visible symptom.
- **Security docs.** When doing security work, keep `docs/security/` (Security.md, Auth.md, Data Security.md, Threat Model.md, Security Checklist.md) up to date — create them if missing. Implement and test one rule at a time; never mark a check PASS without evidence.
- **UX.** Before building new screens, write or update the UX docs (UX-BRIEF.md, userflow.md, DESIGN-SYSTEM.md, COMPONENTS.md, SCREEN-SPECS.md). Before launch, run the UX finish audit and log decisions in `docs/ux-audit.md`.
- **Launch.** Run the UK pre-launch gate (legal, privacy, security, accessibility, payments, marketing, vendors/AI, IP, store/web, go/no-go) with evidence before launch and after major changes.
- **Scope.** Reuse the project's existing patterns, keep commits small and focused, and don't rewrite unrelated code. Prefer free-tier or low-cost options unless the owner says otherwise.
