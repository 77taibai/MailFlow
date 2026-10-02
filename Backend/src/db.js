import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'mailflow.db'));

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS mailboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'custom',
  auth_type TEXT NOT NULL DEFAULT 'password',
  imap_host TEXT,
  imap_port INTEGER,
  imap_secure INTEGER NOT NULL DEFAULT 1,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_secure INTEGER NOT NULL DEFAULT 1,
  username TEXT,
  password_enc TEXT,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_expires_at INTEGER,
  scope TEXT,
  sync_interval_sec INTEGER,
  dingtalk_enabled INTEGER NOT NULL DEFAULT 0,
  dingtalk_include TEXT NOT NULL DEFAULT '',
  dingtalk_exclude TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ok',
  last_error TEXT,
  last_sync_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mailbox_id INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT,
  special_use TEXT,
  delimiter TEXT,
  uidvalidity TEXT,
  sync_enabled INTEGER NOT NULL DEFAULT 0,
  last_uid INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(mailbox_id, path)
);

CREATE TABLE IF NOT EXISTS mails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mailbox_id INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  uid INTEGER,
  message_id TEXT,
  in_reply_to TEXT,
  subject TEXT NOT NULL DEFAULT '',
  from_name TEXT,
  from_addr TEXT,
  to_list TEXT,
  cc_list TEXT,
  date INTEGER,
  snippet TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT,
  flags TEXT NOT NULL DEFAULT '[]',
  seen INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  dingtalk_pushed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(mailbox_id, folder_id, uid)
);

CREATE INDEX IF NOT EXISTS idx_mails_folder_date ON mails(folder_id, date DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mail_id INTEGER NOT NULL REFERENCES mails(id) ON DELETE CASCADE,
  filename TEXT,
  content_type TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  path TEXT NOT NULL,
  content_id TEXT,
  created_at INTEGER NOT NULL
);
`);

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  if (value === null || value === undefined) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    return;
  }
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

export function getMailbox(id) {
  return db.prepare('SELECT * FROM mailboxes WHERE id = ?').get(id) || null;
}

export function listMailboxes() {
  return db.prepare('SELECT * FROM mailboxes ORDER BY id').all();
}

export function touchMailboxStatus(id, status, lastError = null) {
  db.prepare('UPDATE mailboxes SET status = ?, last_error = ?, updated_at = ? WHERE id = ?').run(
    status,
    lastError,
    Date.now(),
    id
  );
}
