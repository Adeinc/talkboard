# TalkBoard — community forum (server version)

A mobile-friendly community discussion forum with three sections:
**Community Development**, **Sport**, and **Community History**.

This is the full backend version: a real server with a database, so
threads, replies, photos and accounts are shared by everyone who visits
and survive restarts.

## What it does

- **Three sections.** Community Development and Community History are
  location-aware — threads carry a city/area tag and can be filtered.
- **Anyone can read** without signing in.
- **Accounts with passwords.** Members sign up with a display name and a
  password (hashed with scrypt). Passwords are never stored in plain
  text. Sign-in is required to post, reply, vote or report.
- **Photo uploads.** Up to 4 images per thread or reply, resized
  server-side to keep storage light.
- **30-day auto-delete (enforced).** The server deletes every thread and
  reply 30 days after it was posted, along with their photo files. This
  runs hourly and cannot be bypassed.
- **New-member wait gate (enforced).** A new account can reply
  immediately, but can only start threads once it has posted one reply
  or waited 10 minutes — whichever comes first.
- **Reporting.** Every thread and reply has a Report button. Members
  pick a reason; reports are private and go to the moderation queue.
- **Moderation panel.** The first registered account is the admin.
  Admins get a moderation view listing all open reports with the
  reported content shown inline, and can remove or dismiss each one.
- **Soft-delete with restore.** Removed content is hidden from everyone
  immediately but kept in the database, so an admin can restore it if a
  removal was a mistake. Admins see removed items marked as such.
- **Mobile-first design.** Built for phones: large tap targets, a
  scrolling section bar, a floating "New" button, bottom-sheet dialogs,
  and safe-area insets. Scales up cleanly to tablet and desktop.

## The admin account

The **first account that registers becomes the admin** automatically.
So when you deploy, sign up first — that account is yours to moderate
with. To make someone else an admin (or add a second one), set the
`is_admin` column to `1` for their row in the `users` table of
`talkboard.db` using any SQLite tool.

## Running it locally

You need [Node.js](https://nodejs.org) version 18 or newer.

```bash
cd talkboard-server
npm install
npm start
```

Then open <http://localhost:3000> in a browser.

The database is a single file, `talkboard.db`, created automatically on
first run. Uploaded photos are stored in the `uploads/` folder.

## Putting it online

The app is one Node.js process and works on any host that runs Node.
Good free or low-cost options: **Render**, **Railway**, **Fly.io**, or a
small VPS.

General steps (Render is used as the example):

1. Put this folder in a GitHub repository.
2. On Render, create a new **Web Service** and connect that repo.
3. Set the build command to `npm install` and the start command to
   `npm start`.
4. Add a **persistent disk** and mount it at the project folder so
   `talkboard.db` and `uploads/` are not wiped on redeploy. This step
   matters — without a persistent disk, free hosts erase the database
   each time the app restarts.
5. Deploy. Render gives you a public URL.

The server listens on the port given by the `PORT` environment variable,
which hosts set automatically, so no config change is needed.

## Setting up email (confirmation links & notifications)

The board sends a confirmation link when a member signs up. To send
**real email** you need a mail service — the code is written for
[Resend](https://resend.com), which has a free tier.

**Until you set this up, the board still works fully.** With no mail
key, confirmation links are written to the server console and shown
on-screen, so you can test the whole flow locally for free.

To switch on real email, set these environment variables when starting
the server (or in your host's settings):

```
MAIL_PROVIDER   = resend
RESEND_API_KEY  = re_your_key_here      (from resend.com)
MAIL_FROM       = TalkBoard <no-reply@yourdomain.com>
PUBLIC_URL      = https://your-live-site-address
```

`PUBLIC_URL` matters — it's what confirmation links point to. Set it to
your real site address once deployed, otherwise links point to
localhost. No code change is needed; the server picks these up on start.

## Languages

The interface is available in English, Nigerian Pidgin, Yoruba, Hausa
and Igbo — members pick their language from the selector in the header.

Only the **interface** (buttons, labels, menus) is translated. What
members write in their Talks and replies is shown as written — the app
does not machine-translate posts, because automatic translation between
these languages is unreliable enough to distort meaning.

All translated strings live in one file, `public/i18n.js`, grouped and
keyed. **Before a public launch, have a native speaker review the
Yoruba, Hausa and Igbo wording** — UI phrasing has nuances that only a
native speaker reliably catches. Editing a string is quick, and any key
missing from a language automatically falls back to English, so a
partial or in-progress translation is always safe to ship.

## Important limitations — please read

- **You now collect email addresses.** That makes you responsible for
  that personal data. Before a public launch you need a basic privacy
  policy explaining what you collect (email, for confirmation and
  optional notifications) and how someone can have it deleted. A short,
  honest privacy note is enough to start.
- **Password reset isn't built in.** If a member forgets their password,
  there's no automated reset flow yet — an admin would need to clear the
  `pw_hash` and `pw_salt` columns for that user so they can set a new
  one on next sign-in. Adding email-based reset is a sensible next step
  now that email is in place.
- **The 30-day delete is a privacy aid, not a guarantee.** It reliably
  removes content from the site, but anyone can screenshot or copy a
  post before it expires. Users see a notice saying exactly this.
- **Moderation is one admin by default.** The first account is the
  admin. For a busy board you'll likely want several moderators — you
  can promote more accounts by editing the database as described above.
- **No rate limiting yet.** One account could still post rapidly. If the
  board gets busy or attracts spam, add rate limiting per account/IP.
- **Photo storage grows over time.** Old photos are deleted with their
  posts after 30 days, but on a busy board keep an eye on disk usage.

## Project layout

```
talkboard-server/
  server.js          the API: auth, posting, moderation, all logic
  db.js              SQLite storage layer
  package.json
  public/
    index.html       the entire mobile-first frontend
  uploads/           uploaded photos (created on first run)
  talkboard.db       the database file (created on first run)
```

## Suggested next steps

1. Email-based password reset.
2. Rate limiting per account/IP to slow spam and abuse.
3. Multiple named moderators with their own admin panel.
4. Email or push notifications for replies.
5. A "your account" page so members can change their own password.
