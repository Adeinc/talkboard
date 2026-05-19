/* ============================================================
   server.js — TalkBoard backend
   A community forum: Community Development, Sport, Community
   History. Photo uploads, server-enforced 30-day auto-delete,
   and a server-enforced new-member wait gate.
   ============================================================ */
'use strict';
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { Jimp } = require('jimp');
const db = require('./db');
const mailer = require('./mailer');

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || ('http://localhost:' + (process.env.PORT || 3000));
const UPLOADS = path.join(__dirname, 'uploads');
const EXPIRY_MS = 30 * 24 * 3600 * 1000;       // 30 days
const NEWMEMBER_WAIT_MS = 10 * 60 * 1000;      // 10 minutes
const MAX_PHOTOS = 4;

const SECTIONS = {
  development: { name: 'Community Development', local: true },
  sport:       { name: 'Sport',                local: false },
  history:     { name: 'Community History',    local: true },
};

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(UPLOADS, { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- helpers ---------- */
const id = () =>
  crypto.randomBytes(8).toString('hex');
const token = () =>
  crypto.randomBytes(24).toString('hex');

/* Password hashing with scrypt (built into Node, no dependency). */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  // constant-time comparison to avoid timing attacks
  const a = Buffer.from(test, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function userFromReq(req) {
  const t = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!t) return null;
  return db.get('SELECT * FROM users WHERE token = ?', [t]);
}

/* ---- roles ----
   'member'     — ordinary user
   'moderator'  — limited admin: can remove/restore content & clear
                  reports, but cannot promote/demote anyone and cannot
                  touch a fellow admin's posts
   'superadmin' — full admin: everything a moderator can do, plus
                  promoting/demoting others and moderating admin posts */
function roleOf(user) {
  if (!user) return 'guest';
  // legacy support: an old is_admin flag with no role means superadmin
  if (user.role) return user.role;
  return user.is_admin ? 'superadmin' : 'member';
}
function isStaff(user) {
  const r = roleOf(user);
  return r === 'moderator' || r === 'superadmin';
}
function isSuperAdmin(user) {
  return roleOf(user) === 'superadmin';
}
/* kept so existing call-sites still work — true for any staff member */
function isAdmin(user) {
  return isStaff(user);
}

/* ---- reputation: the "Talk Score" ----
   Built from a member's own contribution AND the attention it earned.
   Attention is weighted higher than raw volume, so 3 well-received
   Talks beat 30 ignored ones — this rewards quality, not spam.
     started a Talk        : 5 points each
     wrote a reply         : 2 points each
     net upvotes received  : 3 points each (across their Talks + replies)
     views on their Talks  : 1 point per 20 views
   Removed content is excluded so it can't farm score. */
const TIERS = [
  { name: 'Listener',             min: 0,    color: '#8b909e', icon: '👂' },
  { name: 'Speaker',              min: 30,   color: '#0891b2', icon: '🗣️' },
  { name: 'Storyteller',          min: 120,  color: '#15a34a', icon: '📖' },
  { name: 'Voice of the People',  min: 350,  color: '#5b21e6', icon: '📣' },
  { name: 'Keeper of Stories',    min: 800,  color: '#d97706', icon: '👑' },
];
function tierFor(score) {
  let t = TIERS[0];
  for (const tier of TIERS) if (score >= tier.min) t = tier;
  return t;
}
function reputation(userName) {
  const talks = db.all(
    'SELECT up, down, views FROM threads WHERE author = ? AND removed = 0',
    [userName]);
  const replies = db.all(
    'SELECT up, down FROM posts WHERE author = ? AND removed = 0',
    [userName]);
  let score = 0;
  score += talks.length * 5;
  score += replies.length * 2;
  let netUp = 0, views = 0;
  for (const t of talks) { netUp += (t.up - t.down); views += (t.views || 0); }
  for (const r of replies) { netUp += (r.up - r.down); }
  score += Math.max(0, netUp) * 3;
  score += Math.floor(views / 20);
  const tier = tierFor(score);
  return {
    score,
    tier: tier.name,
    tierColor: tier.color,
    tierIcon: tier.icon,
    talkCount: talks.length,
    replyCount: replies.length,
  };
}
/* "March 2026" style join label */
function joinedLabel(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/* the three verification badges a member may hold.
   Each is granted only by the lead admin. */
const BADGE_TYPES = {
  verified: { key: 'verified',     label: 'Verified', mark: '✓', color: '#5b21e6' },
  local:    { key: 'local',        label: 'Local',    mark: '📍', color: '#15a34a' },
  official: { key: 'official',     label: 'Official', mark: '★', color: '#d97706' },
};
function badgesFor(userRow) {
  const out = [];
  if (userRow.verified)     out.push(BADGE_TYPES.verified);
  if (userRow.vfd_local)    out.push(BADGE_TYPES.local);
  if (userRow.vfd_official) out.push(BADGE_TYPES.official);
  return out;
}

/* Attach photos + a couple of derived fields to a thread/post row. */
function photosFor(ownerId) {
  return db
    .all('SELECT filename FROM photos WHERE owner_id = ? ORDER BY ord', [ownerId])
    .map((p) => '/uploads/' + p.filename);
}

/* Shape a thread for the client.
   viewer is the requesting user (or null). Admins see removed posts
   marked as removed; everyone else doesn't see them at all. */
function shapeThread(row, includePosts, viewer) {
  const admin = isAdmin(viewer);
  // small cache so an author's reputation is computed once per call
  const repCache = {};
  const authorInfo = (name) => {
    if (repCache[name]) return repCache[name];
    const u = db.get(
      'SELECT joined_at, role, verified, vfd_local, vfd_official FROM users WHERE name = ?',
      [name]);
    const rep = reputation(name);
    const info = {
      rep, tier: rep.tier, tierColor: rep.tierColor, tierIcon: rep.tierIcon,
      score: rep.score,
      joined: u ? joinedLabel(u.joined_at) : '',
      role: u ? roleOf(u) : 'member',
      badges: u ? badgesFor(u) : [],
    };
    repCache[name] = info;
    return info;
  };

  const ai = authorInfo(row.author);
  const t = {
    id: row.id, section: row.section, title: row.title, body: row.body,
    author: row.author, location: row.location, created: row.created,
    up: row.up, down: row.down, views: row.views || 0,
    photos: photosFor(row.id),
    removed: !!row.removed,
    authorTier: ai.tier, authorTierColor: ai.tierColor, authorTierIcon: ai.tierIcon,
    authorScore: ai.score, authorJoined: ai.joined, authorRole: ai.role,
    authorBadges: ai.badges,
  };
  if (row.removed && admin) {
    t.removedBy = row.removed_by;
    t.removedAt = row.removed_at;
  }
  const postRows = db.all(
    'SELECT * FROM posts WHERE thread_id = ? ORDER BY created', [row.id]);
  const visible = postRows.filter((p) => !p.removed);
  t.replyCount = visible.length;
  if (includePosts) {
    const shown = admin ? postRows : visible;
    t.posts = shown.map((p) => {
      const pi = authorInfo(p.author);
      return {
        id: p.id, author: p.author,
        body: p.removed && !admin ? '' : p.body,
        created: p.created, up: p.up, down: p.down,
        photos: p.removed && !admin ? [] : photosFor(p.id),
        removed: !!p.removed,
        removedBy: p.removed ? p.removed_by : undefined,
        authorTier: pi.tier, authorTierColor: pi.tierColor, authorTierIcon: pi.tierIcon,
        authorScore: pi.score, authorJoined: pi.joined, authorRole: pi.role,
        authorBadges: pi.badges,
      };
    });
  }
  return t;
}

/* count of unresolved reports — shown to admins */
function openReportCount() {
  const r = db.get('SELECT COUNT(*) AS n FROM reports WHERE resolved = 0');
  return r ? r.n : 0;
}

/* ---------- email confirmation ---------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Create a fresh confirmation token for a user and email it.
   Returns the link (useful for the console-fallback case so the
   UI can show it during local testing). */
async function sendConfirmation(userRow) {
  // clear any older tokens for this user
  db.run('DELETE FROM email_tokens WHERE user_id = ?', [userRow.id]);
  const tk = crypto.randomBytes(20).toString('hex');
  db.run('INSERT INTO email_tokens (token, user_id, email, created) VALUES (?,?,?,?)',
    [tk, userRow.id, userRow.email, Date.now()]);
  const link = PUBLIC_URL + '/confirm?token=' + tk;
  const msg = mailer.confirmationEmail(userRow.name, link);
  const res = await mailer.sendMail({ to: userRow.email, ...msg });
  // when no mail key is set, hand the link back so it can be shown on-screen
  return { link, mode: res.mode };
}

/* ---------- the 30-day deletion job (server-enforced) ---------- */
function deleteExpired() {
  const cutoff = Date.now() - EXPIRY_MS;
  // gather every owner id about to be removed, so we can delete files
  const oldThreads = db.all('SELECT id FROM threads WHERE created < ?', [cutoff]);
  const oldPosts = db.all('SELECT id FROM posts WHERE created < ?', [cutoff]);
  const owners = [...oldThreads, ...oldPosts].map((r) => r.id);

  for (const owner of owners) {
    const files = db.all('SELECT filename FROM photos WHERE owner_id = ?', [owner]);
    for (const f of files) {
      const fp = path.join(UPLOADS, f.filename);
      fs.existsSync(fp) && fs.unlinkSync(fp);
    }
    db.run('DELETE FROM photos WHERE owner_id = ?', [owner]);
  }
  // delete replies on expired threads too
  for (const t of oldThreads) {
    db.run('DELETE FROM posts WHERE thread_id = ?', [t.id]);
  }
  db.run('DELETE FROM posts WHERE created < ?', [cutoff]);
  db.run('DELETE FROM threads WHERE created < ?', [cutoff]);
  if (owners.length) {
    console.log(`[expiry] removed ${oldThreads.length} threads, ` +
      `${oldPosts.length} replies older than 30 days`);
  }
}

/* ---------- the new-member wait gate (server-enforced) ---------- */
function canCreateThreads(user) {
  if (!user) return { ok: false, reason: 'signin' };
  if (user.has_replied) return { ok: true };
  const left = user.joined_at + NEWMEMBER_WAIT_MS - Date.now();
  if (left <= 0) return { ok: true };
  return { ok: false, reason: 'wait', msLeft: left };
}

/* ============================================================
   API ROUTES
   ============================================================ */

/* sign up — creates an account with a password and email.
   The very first account registered becomes the admin. */
app.post('/api/signup', async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 20);
  const city = String(req.body.city || '').trim().slice(0, 40);
  const password = String(req.body.password || '');
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 120);
  if (name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' });
  // usernames may only contain letters, numbers and underscores — no spaces
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    return res.status(400).json({
      error: 'Username can only use letters, numbers and underscores — no spaces. ' +
        'For example "Ola 101" should be "Ola101" or "Ola_101".',
    });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });

  const existing = db.get('SELECT id FROM users WHERE name = ?', [name]);
  if (existing) return res.status(409).json({ error: 'That display name is already taken' });
  const emailTaken = db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (emailTaken) return res.status(409).json({ error: 'That email is already registered' });

  const isFirst = !db.get('SELECT id FROM users LIMIT 1');
  const { salt, hash } = hashPassword(password);
  const tk = token();
  db.run(
    `INSERT INTO users (name, city, token, joined_at, pw_hash, pw_salt, is_admin, role, email)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [name, city, tk, Date.now(), hash, salt, isFirst ? 1 : 0,
     isFirst ? 'superadmin' : 'member', email]);
  const user = db.get('SELECT * FROM users WHERE name = ?', [name]);

  // send the confirmation email (or log it to console if no mail key)
  let confirm = {};
  try { confirm = await sendConfirmation(user); } catch (e) { console.error(e); }

  const out = publicUser(user);
  // during local testing with no mail key, return the link so the UI can show it
  if (confirm.mode === 'console' && confirm.link) out.confirmLinkForTesting = confirm.link;
  res.json(out);
});

/* the email link lands here — confirm the address, then redirect home */
app.get('/confirm', (req, res) => {
  const tk = String(req.query.token || '');
  const row = db.get('SELECT * FROM email_tokens WHERE token = ?', [tk]);
  if (!row) {
    return res.send(confirmPage(false,
      'This confirmation link is invalid or has already been used.'));
  }
  // links older than 7 days expire
  if (Date.now() - row.created > 7 * 24 * 3600 * 1000) {
    db.run('DELETE FROM email_tokens WHERE token = ?', [tk]);
    return res.send(confirmPage(false,
      'This confirmation link has expired. Sign in and request a new one.'));
  }
  db.run('UPDATE users SET email_confirmed = 1 WHERE id = ?', [row.user_id]);
  db.run('DELETE FROM email_tokens WHERE token = ?', [tk]);
  res.send(confirmPage(true, 'Your email is confirmed. Thank you!'));
});

/* a tiny self-contained page shown after clicking the email link */
function confirmPage(ok, message) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TalkBoard — Email confirmation</title>
<style>body{font-family:sans-serif;background:#f1f2f6;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0}
.box{background:#fff;padding:36px 30px;border-radius:16px;max-width:380px;
text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.1)}
h1{color:${ok ? '#15a34a' : '#e11d48'};font-size:22px;margin:0 0 8px}
p{color:#5b6170;font-size:14px}a{display:inline-block;margin-top:16px;
background:#5b21e6;color:#fff;padding:11px 20px;border-radius:8px;
text-decoration:none;font-weight:700}</style></head>
<body><div class="box"><h1>${ok ? '✓ Confirmed' : 'Link problem'}</h1>
<p>${message}</p><a href="/">Go to TalkBoard</a></div></body></html>`;
}

/* signed-in member asks for a fresh confirmation email */
app.post('/api/resend-confirmation', async (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.status(401).json({ error: 'Sign in first' });
  if (user.email_confirmed) return res.json({ ok: true, already: true });
  if (!user.email) return res.status(400).json({ error: 'No email on this account' });
  let confirm = {};
  try { confirm = await sendConfirmation(user); } catch (e) { console.error(e); }
  const out = { ok: true };
  if (confirm.mode === 'console' && confirm.link) out.confirmLinkForTesting = confirm.link;
  res.json(out);
});

/* ---------- notifications ---------- */

/* Create a notification for a member and, if they've opted in and
   confirmed their email, also send it by email. Never notify a
   member about their own action. */
async function notify({ to, actor, kind, text, threadId }) {
  if (!to || to === actor) return;
  const target = db.get('SELECT * FROM users WHERE name = ?', [to]);
  if (!target) return;
  db.run(
    `INSERT INTO notifications (user_name, kind, text, link_tid, actor, created)
     VALUES (?,?,?,?,?,?)`,
    [to, kind, text, threadId || '', actor || '', Date.now()]);
  // optional email — only if opted in AND email confirmed
  if (target.notify_email && target.email_confirmed && target.email) {
    const link = PUBLIC_URL + (threadId ? '/?t=' + threadId : '/');
    mailer.sendMail({
      to: target.email,
      subject: 'TalkBoard — ' + text,
      text: `Hi ${target.name},\n\n${text}\n\nOpen TalkBoard: ${link}\n\n` +
        `— TalkBoard\n(You can turn these emails off in your account settings.)`,
    }).catch((e) => console.error('[notify] email failed:', e.message));
  }
}

/* this member's notifications, newest first */
app.get('/api/notifications', (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.status(401).json({ error: 'Sign in first' });
  const rows = db.all(
    'SELECT * FROM notifications WHERE user_name = ? ORDER BY created DESC LIMIT 40',
    [user.name]);
  const unseen = rows.filter((r) => !r.seen).length;
  res.json({
    unseen,
    items: rows.map((r) => ({
      id: r.id, kind: r.kind, text: r.text, threadId: r.link_tid,
      actor: r.actor, created: r.created, seen: !!r.seen,
    })),
  });
});

/* mark all this member's notifications as seen */
app.post('/api/notifications/seen', (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.status(401).json({ error: 'Sign in first' });
  db.run('UPDATE notifications SET seen = 1 WHERE user_name = ?', [user.name]);
  res.json({ ok: true });
});

/* update this member's email-notification preference */
app.post('/api/notifications/pref', (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.status(401).json({ error: 'Sign in first' });
  const on = req.body.emailNotify ? 1 : 0;
  db.run('UPDATE users SET notify_email = ? WHERE id = ?', [on, user.id]);
  res.json({ ok: true, emailNotify: !!on });
});

/* sign in — checks the password.
   Legacy accounts created before passwords existed have no pw_hash;
   such an account can sign in once with any password and that password
   is then set, so old users aren't locked out. */
app.post('/api/signin', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 20);
  const password = String(req.body.password || '');
  const city = String(req.body.city || '').trim().slice(0, 40);
  if (name.length < 2) return res.status(400).json({ error: 'Enter your display name' });

  const user = db.get('SELECT * FROM users WHERE name = ?', [name]);
  if (!user) return res.status(404).json({ error: 'No account with that name — try signing up' });

  if (!user.pw_hash) {
    // legacy passwordless account: adopt the supplied password now
    if (password.length < 6) {
      return res.status(400).json({
        error: 'This account has no password yet. Enter one (6+ characters) to set it.',
        needsPassword: true,
      });
    }
    const { salt, hash } = hashPassword(password);
    db.run('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?', [hash, salt, user.id]);
    user.pw_hash = hash; user.pw_salt = salt;
  } else if (!verifyPassword(password, user.pw_salt, user.pw_hash)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  if (city && city !== user.city) {
    db.run('UPDATE users SET city = ? WHERE id = ?', [city, user.id]);
    user.city = city;
  }
  res.json(publicUser(user));
});

/* shape a user record for the client — never leaks the hash */
function publicUser(user) {
  const role = roleOf(user);
  const rep = reputation(user.name);
  return {
    token: user.token, name: user.name, city: user.city,
    joinedAt: user.joined_at, joinedLabel: joinedLabel(user.joined_at),
    hasReplied: !!user.has_replied,
    role: role,
    isAdmin: role === 'moderator' || role === 'superadmin',
    isSuperAdmin: role === 'superadmin',
    canCreateThreads: canCreateThreads(user).ok,
    score: rep.score, tier: rep.tier, tierColor: rep.tierColor, tierIcon: rep.tierIcon,
    talkCount: rep.talkCount, replyCount: rep.replyCount,
    badges: badgesFor(user),
    emailConfirmed: !!user.email_confirmed,
    hasEmail: !!user.email,
    emailNotify: user.notify_email === undefined ? true : !!user.notify_email,
  };
}

/* current user info (used to refresh gate state and admin status) */
app.get('/api/me', (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  const u = publicUser(user);
  delete u.token; // /me doesn't need to re-send the token
  res.json(u);
});

/* list threads, optionally by section and area */
app.get('/api/threads', (req, res) => {
  deleteExpired();
  const viewer = userFromReq(req);
  const { section, area } = req.query;
  let sql = 'SELECT * FROM threads';
  const params = [];
  if (section && SECTIONS[section]) { sql += ' WHERE section = ?'; params.push(section); }
  sql += ' ORDER BY created DESC';
  let rows = db.all(sql, params);
  // soft-removed threads vanish for everyone (admins moderate via the panel)
  rows = rows.filter((r) => !r.removed);
  if (area) {
    const q = String(area).toLowerCase();
    rows = rows.filter((r) => (r.location || '').toLowerCase().includes(q));
  }
  res.json(rows.map((r) => shapeThread(r, false, viewer)));
});

/* recent views, kept in memory: key -> timestamp.
   A view from the same person/IP within VIEW_WINDOW_MS is not
   re-counted, so refreshing a page doesn't inflate the number. */
const recentViews = new Map();
const VIEW_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

function countView(threadId, row, viewer, req) {
  // don't count the thread's own author viewing their thread
  if (viewer && viewer.name === row.author) return;
  // identify the visitor: signed-in name, else IP address
  const who = viewer ? 'u:' + viewer.name
    : 'ip:' + (req.ip || req.headers['x-forwarded-for'] || 'anon');
  const key = who + '|' + threadId;
  const now = Date.now();
  const last = recentViews.get(key);
  if (last && now - last < VIEW_WINDOW_MS) return; // seen recently, skip
  recentViews.set(key, now);
  db.run('UPDATE threads SET views = views + 1 WHERE id = ?', [threadId]);
  row.views = (row.views || 0) + 1;
  // occasionally prune the map so it can't grow without bound
  if (recentViews.size > 5000) {
    for (const [k, t] of recentViews) {
      if (now - t > VIEW_WINDOW_MS) recentViews.delete(k);
    }
  }
}

/* single thread with all replies */
app.get('/api/threads/:tid', (req, res) => {
  deleteExpired();
  const viewer = userFromReq(req);
  const row = db.get('SELECT * FROM threads WHERE id = ?', [req.params.tid]);
  if (!row) return res.status(404).json({ error: 'Thread not found or expired' });
  if (row.removed && !isAdmin(viewer)) {
    return res.status(404).json({ error: 'This thread has been removed' });
  }
  countView(req.params.tid, row, viewer, req);
  res.json(shapeThread(row, true, viewer));
});

/* image upload handling — store to disk, then resize in place */
const upload = multer({
  dest: UPLOADS,
  limits: { fileSize: 8 * 1024 * 1024, files: MAX_PHOTOS },
});

async function processPhotos(files, ownerId, ownerKind) {
  let ord = 0;
  for (const f of (files || []).slice(0, MAX_PHOTOS)) {
    const outName = id() + '.jpg';
    const outPath = path.join(UPLOADS, outName);
    try {
      const img = await Jimp.read(f.path);
      if (img.bitmap.width > 1280 || img.bitmap.height > 1280) {
        img.scaleToFit({ w: 1280, h: 1280 });
      }
      await img.write(outPath);
    } catch (e) {
      fs.copyFileSync(f.path, outPath); // fallback: keep original
    }
    fs.existsSync(f.path) && fs.unlinkSync(f.path); // remove multer temp
    db.run(
      'INSERT INTO photos (owner_id, owner_kind, filename, ord) VALUES (?,?,?,?)',
      [ownerId, ownerKind, outName, ord++]);
  }
}

/* create a thread — gated for new members */
app.post('/api/threads', upload.array('photos', MAX_PHOTOS), async (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.status(401).json({ error: 'Sign in to post' });

  const gate = canCreateThreads(user);
  if (!gate.ok) {
    return res.status(403).json({
      error: 'newmember_gate',
      msLeft: gate.msLeft || 0,
      message: 'New members can reply right away. Starting threads unlocks ' +
        'once you post a reply, or after a short wait.',
    });
  }

  const section = String(req.body.section || '');
  const title = String(req.body.title || '').trim().slice(0, 120);
  const body = String(req.body.body || '').trim().slice(0, 8000);
  const location = String(req.body.location || '').trim().slice(0, 40);
  if (!SECTIONS[section]) return res.status(400).json({ error: 'Unknown section' });
  if (title.length < 6) return res.status(400).json({ error: 'Title too short' });
  if (body.length < 10) return res.status(400).json({ error: 'Post too short' });
  if (SECTIONS[section].local && !location) {
    return res.status(400).json({ error: 'This section needs a city / area' });
  }

  const tid = id();
  db.run(
    `INSERT INTO threads (id, section, title, body, author, location, created, up, down)
     VALUES (?,?,?,?,?,?,?,1,0)`,
    [tid, section, title, body, user.name, location, Date.now()]);
  await processPhotos(req.files, tid, 'thread');
  db.run('INSERT OR REPLACE INTO votes (user_id,target_id,dir) VALUES (?,?,?)',
    [user.id, tid, 'up']);
  res.json(shapeThread(db.get('SELECT * FROM threads WHERE id = ?', [tid]), true));
});

/* reply to a thread — open to all members; unlocks the gate */
app.post('/api/threads/:tid/replies', upload.array('photos', MAX_PHOTOS),
  async (req, res) => {
    const user = userFromReq(req);
    if (!user) return res.status(401).json({ error: 'Sign in to reply' });
    const thread = db.get('SELECT * FROM threads WHERE id = ?', [req.params.tid]);
    if (!thread) return res.status(404).json({ error: 'Thread not found or expired' });

    const body = String(req.body.body || '').trim().slice(0, 8000);
    const hasPhotos = req.files && req.files.length;
    if (body.length < 2 && !hasPhotos) {
      return res.status(400).json({ error: 'Write a reply or add a photo' });
    }
    const pid = id();
    db.run(
      'INSERT INTO posts (id, thread_id, author, body, created, up, down) VALUES (?,?,?,?,?,0,0)',
      [pid, thread.id, user.name, body, Date.now()]);
    await processPhotos(req.files, pid, 'post');

    // posting a reply permanently unlocks thread creation for this member
    if (!user.has_replied) {
      db.run('UPDATE users SET has_replied = 1 WHERE id = ?', [user.id]);
    }
    // notify the Talk's author that someone replied
    await notify({
      to: thread.author,
      actor: user.name,
      kind: 'reply',
      text: `${user.name} replied to your Talk "${thread.title}"`,
      threadId: thread.id,
    });
    res.json(shapeThread(db.get('SELECT * FROM threads WHERE id = ?', [thread.id]), true));
  });

/* vote on a thread or post */
app.post('/api/vote', (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.status(401).json({ error: 'Sign in to vote' });
  const { targetId, kind, dir } = req.body;
  if (!['up', 'down'].includes(dir) || !['thread', 'post'].includes(kind)) {
    return res.status(400).json({ error: 'Bad vote' });
  }
  const table = kind === 'thread' ? 'threads' : 'posts';
  const row = db.get(`SELECT * FROM ${table} WHERE id = ?`, [targetId]);
  if (!row) return res.status(404).json({ error: 'Target not found' });

  const prev = db.get(
    'SELECT dir FROM votes WHERE user_id = ? AND target_id = ?', [user.id, targetId]);
  let up = row.up, down = row.down;
  if (prev) { prev.dir === 'up' ? up-- : down--; }
  if (prev && prev.dir === dir) {
    db.run('DELETE FROM votes WHERE user_id = ? AND target_id = ?', [user.id, targetId]);
  } else {
    db.run('INSERT OR REPLACE INTO votes (user_id,target_id,dir) VALUES (?,?,?)',
      [user.id, targetId, dir]);
    dir === 'up' ? up++ : down++;
  }
  db.run(`UPDATE ${table} SET up = ?, down = ? WHERE id = ?`, [up, down, targetId]);
  res.json({ up, down });
});

/* this user's votes (so the UI can highlight them) */
app.get('/api/myvotes', (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.json({});
  const rows = db.all('SELECT target_id, dir FROM votes WHERE user_id = ?', [user.id]);
  const map = {};
  rows.forEach((r) => { map[r.target_id] = r.dir; });
  res.json(map);
});

/* ---------- reporting & moderation ---------- */

/* any signed-in member can report a thread or reply */
app.post('/api/report', (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.status(401).json({ error: 'Sign in to report content' });
  const { targetId, kind } = req.body;
  const reason = String(req.body.reason || '').trim().slice(0, 300);
  if (!['thread', 'post'].includes(kind)) {
    return res.status(400).json({ error: 'Bad report' });
  }
  const table = kind === 'thread' ? 'threads' : 'posts';
  const row = db.get(`SELECT id FROM ${table} WHERE id = ?`, [targetId]);
  if (!row) return res.status(404).json({ error: 'That content no longer exists' });

  // one open report per user per item, so a single user can't pile on
  const dup = db.get(
    'SELECT id FROM reports WHERE target_id = ? AND reporter = ? AND resolved = 0',
    [targetId, user.name]);
  if (dup) return res.json({ ok: true, already: true });

  db.run(
    `INSERT INTO reports (target_id, target_kind, reporter, reason, created)
     VALUES (?,?,?,?,?)`,
    [targetId, kind, user.name, reason, Date.now()]);
  res.json({ ok: true });
});

/* admin: list open reports with the reported content attached */
app.get('/api/admin/reports', (req, res) => {
  const user = userFromReq(req);
  if (!isAdmin(user)) return res.status(403).json({ error: 'Admins only' });
  const reports = db.all('SELECT * FROM reports WHERE resolved = 0 ORDER BY created DESC');
  const out = reports.map((r) => {
    let content = null;
    if (r.target_kind === 'thread') {
      const t = db.get('SELECT * FROM threads WHERE id = ?', [r.target_id]);
      if (t) content = {
        kind: 'thread', id: t.id, title: t.title, body: t.body,
        author: t.author, section: t.section, created: t.created,
        removed: !!t.removed, photos: photosFor(t.id),
      };
    } else {
      const p = db.get('SELECT * FROM posts WHERE id = ?', [r.target_id]);
      if (p) content = {
        kind: 'post', id: p.id, threadId: p.thread_id, body: p.body,
        author: p.author, created: p.created,
        removed: !!p.removed, photos: photosFor(p.id),
      };
    }
    return {
      id: r.id, targetId: r.target_id, targetKind: r.target_kind,
      reporter: r.reporter, reason: r.reason, created: r.created,
      content, // null if the content was already deleted
    };
  });
  res.json({ reports: out, openCount: out.length });
});

/* admin: remove (soft-delete) a thread or reply.
   A moderator may remove member and fellow-moderator content, but
   NOT a super-admin's content — only a super-admin can do that. */
app.post('/api/admin/remove', async (req, res) => {
  const user = userFromReq(req);
  if (!isStaff(user)) return res.status(403).json({ error: 'Admins only' });
  const { targetId, kind } = req.body;
  const table = kind === 'thread' ? 'threads' : kind === 'post' ? 'posts' : null;
  if (!table) return res.status(400).json({ error: 'Bad target' });
  const row = db.get(`SELECT * FROM ${table} WHERE id = ?`, [targetId]);
  if (!row) return res.status(404).json({ error: 'Content not found' });

  // is the content's author a super-admin?
  const author = db.get('SELECT role, is_admin FROM users WHERE name = ?', [row.author]);
  if (author && roleOf(author) === 'superadmin' && !isSuperAdmin(user)) {
    return res.status(403).json({
      error: "This post is by a lead admin — only a lead admin can remove it." });
  }

  db.run(
    `UPDATE ${table} SET removed = 1, removed_by = ?, removed_at = ? WHERE id = ?`,
    [user.name, Date.now(), targetId]);
  db.run('UPDATE reports SET resolved = 1 WHERE target_id = ?', [targetId]);
  // let the author know their content was removed by a moderator
  await notify({
    to: row.author,
    actor: user.name,
    kind: 'removed',
    text: `A moderator removed your ${kind === 'thread' ? 'Talk' : 'reply'}` +
      (kind === 'thread' && row.title ? ` "${row.title}"` : ''),
    threadId: kind === 'thread' ? row.id : row.thread_id,
  });
  res.json({ ok: true, openCount: openReportCount() });
});

/* ---- admin management (super-admin only) ---- */

/* list all staff and members, so the super-admin can manage roles */
app.get('/api/admin/team', (req, res) => {
  const user = userFromReq(req);
  if (!isSuperAdmin(user)) return res.status(403).json({ error: 'Lead admins only' });
  const rows = db.all(
    "SELECT name, role, joined_at FROM users WHERE role IN ('moderator','superadmin') ORDER BY role DESC, name");
  res.json({ team: rows.map((r) => ({ name: r.name, role: r.role, joinedAt: r.joined_at })) });
});

/* promote a member to moderator, or demote a moderator to member */
app.post('/api/admin/setrole', (req, res) => {
  const user = userFromReq(req);
  if (!isSuperAdmin(user)) return res.status(403).json({ error: 'Lead admins only' });
  const name = String(req.body.name || '').trim();
  const role = String(req.body.role || '');
  if (!['moderator', 'member'].includes(role)) {
    return res.status(400).json({ error: 'Role must be moderator or member' });
  }
  const target = db.get('SELECT * FROM users WHERE name = ?', [name]);
  if (!target) return res.status(404).json({ error: 'No member with that name' });
  if (roleOf(target) === 'superadmin') {
    return res.status(403).json({ error: "You can't change a lead admin's role here." });
  }
  db.run('UPDATE users SET role = ?, is_admin = ? WHERE name = ?',
    [role, role === 'moderator' ? 1 : 0, name]);
  res.json({ ok: true, name, role });
});

/* lead admin only: grant or remove one of the three verification
   badges (verified / local / official). Restricted to the lead admin
   because these badges signal trust to the whole community. */
app.post('/api/admin/verify', (req, res) => {
  const user = userFromReq(req);
  if (!isSuperAdmin(user)) return res.status(403).json({ error: 'Lead admin only' });
  const name = String(req.body.name || '').trim();
  const badge = String(req.body.badge || '');
  const on = req.body.on ? 1 : 0;
  const column = { verified: 'verified', local: 'vfd_local', official: 'vfd_official' }[badge];
  if (!column) return res.status(400).json({ error: 'Unknown badge type' });
  const target = db.get('SELECT id FROM users WHERE name = ?', [name]);
  if (!target) return res.status(404).json({ error: 'No member with that name' });
  db.run(`UPDATE users SET ${column} = ? WHERE name = ?`, [on, name]);
  res.json({ ok: true, name, badge, on: !!on });
});

/* admin: restore a soft-removed thread or reply */
app.post('/api/admin/restore', (req, res) => {
  const user = userFromReq(req);
  if (!isAdmin(user)) return res.status(403).json({ error: 'Admins only' });
  const { targetId, kind } = req.body;
  const table = kind === 'thread' ? 'threads' : kind === 'post' ? 'posts' : null;
  if (!table) return res.status(400).json({ error: 'Bad target' });
  db.run(
    `UPDATE ${table} SET removed = 0, removed_by = '', removed_at = 0 WHERE id = ?`,
    [targetId]);
  res.json({ ok: true });
});

/* admin: dismiss a report without removing the content */
app.post('/api/admin/dismiss', (req, res) => {
  const user = userFromReq(req);
  if (!isAdmin(user)) return res.status(403).json({ error: 'Admins only' });
  const reportId = req.body.reportId;
  db.run('UPDATE reports SET resolved = 1 WHERE id = ?', [reportId]);
  res.json({ ok: true, openCount: openReportCount() });
});

/* fallback to the SPA — Express 5 needs a named splat, not bare '*' */
app.get('/{*any}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ---------- boot ---------- */
(async () => {
  if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });
  await db.open();
  deleteExpired();
  setInterval(deleteExpired, 3600 * 1000); // hourly sweep
  app.listen(PORT, () => {
    console.log(`TalkBoard running on http://localhost:${PORT}`);
  });
})();
