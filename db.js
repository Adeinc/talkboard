/* ============================================================
   db.js — SQLite storage for TalkBoard
   Uses sql.js (pure JavaScript, no native compilation needed).
   The database lives in memory and is flushed to talkboard.db
   on disk after every write, so data survives restarts.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_FILE = path.join(__dirname, 'talkboard.db');
let SQL = null;
let db = null;

/* Load (or create) the database. Call once at startup. */
async function open() {
  SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    db = new SQL.Database();
  }
  migrate();
  flush();
  return db;
}

/* Create tables if they don't exist yet, then run lightweight
   migrations so older databases pick up new columns. */
function migrate() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT UNIQUE NOT NULL,
      city        TEXT DEFAULT '',
      token       TEXT UNIQUE NOT NULL,
      joined_at   INTEGER NOT NULL,
      has_replied INTEGER DEFAULT 0,
      pw_hash     TEXT DEFAULT '',
      pw_salt     TEXT DEFAULT '',
      is_admin    INTEGER DEFAULT 0,
      role        TEXT DEFAULT 'member',
      verified    INTEGER DEFAULT 0,
      vfd_local   INTEGER DEFAULT 0,
      vfd_official INTEGER DEFAULT 0,
      email          TEXT DEFAULT '',
      email_confirmed INTEGER DEFAULT 0,
      notify_email   INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS threads (
      id         TEXT PRIMARY KEY,
      section    TEXT NOT NULL,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      author     TEXT NOT NULL,
      location   TEXT DEFAULT '',
      created    INTEGER NOT NULL,
      up         INTEGER DEFAULT 1,
      down       INTEGER DEFAULT 0,
      views      INTEGER DEFAULT 0,
      removed    INTEGER DEFAULT 0,
      removed_by TEXT DEFAULT '',
      removed_at INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS posts (
      id        TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      author    TEXT NOT NULL,
      body      TEXT NOT NULL,
      created   INTEGER NOT NULL,
      up        INTEGER DEFAULT 0,
      down      INTEGER DEFAULT 0,
      removed    INTEGER DEFAULT 0,
      removed_by TEXT DEFAULT '',
      removed_at INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS photos (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id  TEXT NOT NULL,
      owner_kind TEXT NOT NULL,
      filename  TEXT NOT NULL,
      ord       INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS votes (
      user_id   INTEGER NOT NULL,
      target_id TEXT NOT NULL,
      dir       TEXT NOT NULL,
      PRIMARY KEY (user_id, target_id)
    );
    CREATE TABLE IF NOT EXISTS reports (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id  TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      reporter   TEXT NOT NULL,
      reason     TEXT DEFAULT '',
      created    INTEGER NOT NULL,
      resolved   INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS email_tokens (
      token    TEXT PRIMARY KEY,
      user_id  INTEGER NOT NULL,
      email    TEXT NOT NULL,
      created  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT NOT NULL,
      kind      TEXT NOT NULL,
      text      TEXT NOT NULL,
      link_tid  TEXT DEFAULT '',
      actor     TEXT DEFAULT '',
      created   INTEGER NOT NULL,
      seen      INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_name, seen);
    CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id);
    CREATE INDEX IF NOT EXISTS idx_photos_owner ON photos(owner_id);
    CREATE INDEX IF NOT EXISTS idx_reports_open ON reports(resolved);
  `);

  // ---- migrations for databases created before these columns existed ----
  const cols = (table) =>
    all(`PRAGMA table_info(${table})`).map((c) => c.name);
  const ensure = (table, col, def) => {
    if (!cols(table).includes(col)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  };
  ensure('users', 'pw_hash', "TEXT DEFAULT ''");
  ensure('users', 'pw_salt', "TEXT DEFAULT ''");
  ensure('users', 'is_admin', 'INTEGER DEFAULT 0');
  ensure('users', 'role', "TEXT DEFAULT 'member'");
  ensure('users', 'verified', 'INTEGER DEFAULT 0');
  ensure('users', 'vfd_local', 'INTEGER DEFAULT 0');
  ensure('users', 'vfd_official', 'INTEGER DEFAULT 0');
  ensure('users', 'email', "TEXT DEFAULT ''");
  ensure('users', 'email_confirmed', 'INTEGER DEFAULT 0');
  ensure('users', 'notify_email', 'INTEGER DEFAULT 1');
  // back-fill role from the older is_admin flag: any existing admin
  // becomes a super-admin, everyone else stays a member
  db.run("UPDATE users SET role='superadmin' WHERE is_admin=1 AND (role IS NULL OR role='member')");
  db.run("UPDATE users SET role='member' WHERE role IS NULL OR role=''");
  ensure('threads', 'views', 'INTEGER DEFAULT 0');
  ensure('threads', 'removed', 'INTEGER DEFAULT 0');
  ensure('threads', 'removed_by', "TEXT DEFAULT ''");
  ensure('threads', 'removed_at', 'INTEGER DEFAULT 0');
  ensure('posts', 'removed', 'INTEGER DEFAULT 0');
  ensure('posts', 'removed_by', "TEXT DEFAULT ''");
  ensure('posts', 'removed_at', 'INTEGER DEFAULT 0');
}

/* Persist the in-memory database to disk immediately.
   sql.js holds everything in memory, so every write must be
   followed by a flush or data is lost on restart. */
function flush() {
  try {
    fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
  } catch (e) {
    console.error('DB flush failed:', e.message);
  }
}

/* Run a write statement with bound params. */
function run(sql, params = []) {
  db.run(sql, params);
  flush();
}

/* Return all rows for a query as plain objects. */
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

/* Return the first row, or null. */
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length ? rows[0] : null;
}

module.exports = { open, run, all, get, flush, DB_FILE };
