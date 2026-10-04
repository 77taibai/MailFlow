import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import fs from 'node:fs';
import path from 'node:path';
import { db, getMailbox, touchMailboxStatus } from '../db.js';
import { config } from '../config.js';
import { getCredentials } from './mailboxAuth.js';
import { decidePushForMail } from './dingtalk.js';
import {
  firstAddress,
  normalizeMessageId,
  extractMailHeaders,
  safeDate,
  safeSubject,
} from './mailHeaders.js';

function connectOptions(mailbox, creds) {
  return {
    host: mailbox.imap_host,
    port: mailbox.imap_port || 993,
    secure: Boolean(mailbox.imap_secure),
    auth: creds,
    logger: false,
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 60000,
  };
}

export async function openConnection(mailbox) {
  const creds = await getCredentials(mailbox);
  const client = new ImapFlow(connectOptions(mailbox, creds));
  await client.connect();
  return client;
}

export async function testImap(mailbox) {
  let client;
  try {
    client = await openConnection(mailbox);
    await client.mailboxOpen('INBOX');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (client) await safeLogout(client);
  }
}

async function safeLogout(client) {
  try {
    if (client.usable) await client.logout();
    else client.close();
  } catch {
    try {
      client.close();
    } catch {
      /* ignore */
    }
  }
}

function upsertFolder(mailboxId, f, now) {
  const existing = db
    .prepare('SELECT id, sync_enabled FROM folders WHERE mailbox_id = ? AND path = ?')
    .get(mailboxId, f.path);
  if (existing) {
    db.prepare(
      'UPDATE folders SET name = ?, special_use = ?, delimiter = ?, updated_at = ? WHERE id = ?'
    ).run(f.name, f.specialUse || null, f.delimiter || null, now, existing.id);
    return { id: existing.id, syncEnabled: existing.sync_enabled, lastUid: null, uidvalidity: null };
  }
  const isInbox = f.path === 'INBOX' || f.specialUse === '\\Inbox';
  const info = db
    .prepare(
      `INSERT INTO folders(mailbox_id, path, name, special_use, delimiter, sync_enabled, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      mailboxId,
      f.path,
      f.name,
      f.specialUse || null,
      f.delimiter || null,
      isInbox ? 1 : 0,
      now,
      now
    );
  return { id: Number(info.lastInsertRowid), syncEnabled: isInbox ? 1 : 0, lastUid: 0, uidvalidity: null };
}

function sanitizeFilename(name, idx) {
  const base = path.basename(String(name || 'attachment')).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
  return base ? `${idx}_${base}` : `${idx}_attachment`;
}

function storeAttachments(mailId, attachments) {
  if (!attachments || !attachments.length) return;
  const dir = path.join(config.dataDir, 'attachments', String(mailId));
  fs.mkdirSync(dir, { recursive: true });
  const insert = db.prepare(
    `INSERT INTO attachments(mail_id, filename, content_type, size, path, content_id, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?)`
  );
  attachments.forEach((att, idx) => {
    const safeName = sanitizeFilename(att.filename, idx + 1);
    const filePath = path.join(dir, safeName);
    fs.writeFileSync(filePath, att.content);
    insert.run(
      mailId,
      att.filename || safeName,
      att.contentType || 'application/octet-stream',
      att.content.length,
      filePath,
      att.contentId || null,
      Date.now()
    );
  });
}

function ensureLocalSentFolder(mailboxId, now) {
  const existing = db
    .prepare("SELECT id FROM folders WHERE mailbox_id = ? AND (special_use = '\\Sent' OR path = 'Sent')")
    .get(mailboxId);
  if (existing) return existing.id;
  const info = db
    .prepare(
      `INSERT INTO folders(mailbox_id, path, name, special_use, delimiter, sync_enabled, created_at, updated_at)
       VALUES(?, 'Sent', 'Sent', '\\Sent', '/', 0, ?, ?)`
    )
    .run(mailboxId, now, now);
  return Number(info.lastInsertRowid);
}

export function getSentFolderId(mailboxId) {
  const row = db
    .prepare("SELECT id FROM folders WHERE mailbox_id = ? AND special_use = '\\Sent'")
    .get(mailboxId);
  if (row) return row.id;
  return ensureLocalSentFolder(mailboxId, Date.now());
}

export function findSpecialFolder(mailboxId, specialUse) {
  const row = db
    .prepare('SELECT * FROM folders WHERE mailbox_id = ? AND special_use = ?')
    .get(mailboxId, specialUse);
  return row || null;
}

const SENT_TWIN_WINDOW_MS = 10 * 60 * 1000;

function findSentTwin(mailboxId, folderId, parsed) {
  const rows = db
    .prepare('SELECT * FROM mails WHERE mailbox_id = ? AND folder_id = ?')
    .all(mailboxId, folderId);
  const addr = firstAddress(parsed.from).address;
  const date = safeDate(parsed.date) || Date.now();
  const subject = safeSubject(parsed.subject);
  const messageId = normalizeMessageId(parsed.messageId);
  return rows.find((row) => {
    if (row.message_id && messageId && row.message_id === messageId) return true;
    if ((row.subject || '') !== subject) return false;
    if ((row.from_addr || null) !== addr) return false;
    return Math.abs((row.date || 0) - date) < SENT_TWIN_WINDOW_MS;
  });
}

function insertMail(mailbox, folderRow, msg, parsed) {
  const now = Date.now();
  const flags = Array.from(msg.flags || []);
  const h = extractMailHeaders(parsed);

  if (folderRow.special_use === '\\Sent') {
    const twin = findSentTwin(mailbox.id, folderRow.id, parsed);
    if (twin) {
      db.prepare(
        'UPDATE mails SET uid = ?, flags = ?, seen = 1, size = ?, dingtalk_pushed = 1 WHERE id = ?'
      ).run(msg.uid, JSON.stringify(flags), msg.size || 0, twin.id);
      return { id: twin.id, isNew: false };
    }
  }

  if (h.messageId) {
    const localCopy = db
      .prepare(
        'SELECT id FROM mails WHERE mailbox_id = ? AND message_id = ? AND uid IS NULL'
      )
      .get(mailbox.id, h.messageId);
    if (localCopy) {
      db.prepare(
        `UPDATE mails SET folder_id = ?, uid = ?, flags = ?, seen = ?, size = ?, dingtalk_pushed = 1, date = COALESCE(?, date)
         WHERE id = ?`
      ).run(
        folderRow.id,
        msg.uid,
        JSON.stringify(flags),
        flags.includes('\\Seen') ? 1 : 0,
        msg.size || 0,
        h.date,
        localCopy.id
      );
      return { id: localCopy.id, isNew: false };
    }
  }

  const seen = flags.includes('\\Seen') ? 1 : 0;
  const info = db
    .prepare(
      `INSERT INTO mails(mailbox_id, folder_id, uid, message_id, in_reply_to, reference_ids, subject, from_name, from_addr,
        sender_name, sender_addr, reply_to_name, reply_to_addr, to_list, cc_list, date, snippet, body_text, body_html,
        flags, seen, size, has_attachments, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      mailbox.id,
      folderRow.id,
      msg.uid,
      h.messageId,
      h.inReplyTo,
      h.references.length ? JSON.stringify(h.references) : null,
      h.subject,
      h.fromName,
      h.fromAddr,
      h.senderName,
      h.senderAddr,
      h.replyToName,
      h.replyToAddr,
      h.toList,
      h.ccList,
      h.date || now,
      h.text.replace(/\s+/g, ' ').trim().slice(0, 200),
      h.text,
      h.html,
      JSON.stringify(flags),
      seen,
      msg.size || 0,
      parsed.attachments && parsed.attachments.length ? 1 : 0,
      now
    );
  const mailId = Number(info.lastInsertRowid);
  if (parsed.attachments && parsed.attachments.length) {
    storeAttachments(mailId, parsed.attachments);
  }
  return { id: mailId, isNew: true };
}

export async function syncMailbox(mailboxId) {
  const mailbox = getMailbox(mailboxId);
  if (!mailbox) throw new Error('邮箱不存在');
  const now = Date.now();

  let client;
  try {
    client = await openConnection(mailbox);

    const list = await client.list();
    for (const f of list) {
      upsertFolder(mailbox.id, f, now);
    }

    const folders = db
      .prepare('SELECT * FROM folders WHERE mailbox_id = ? AND sync_enabled = 1 ORDER BY id')
      .all(mailbox.id);

    for (const folder of folders) {
      if (!list.some((f) => f.path === folder.path)) continue;

      const box = await client.mailboxOpen(folder.path);
      const uidvalidity = String(box.uidValidity);

      let lastUid = folder.last_uid;
      if (folder.uidvalidity && folder.uidvalidity !== uidvalidity) {
        const oldMails = db.prepare('SELECT id FROM mails WHERE folder_id = ?').all(folder.id);
        db.prepare('DELETE FROM mails WHERE folder_id = ?').run(folder.id);
        for (const old of oldMails) {
          fs.rm(path.join(config.dataDir, 'attachments', String(old.id)), { recursive: true, force: true }, () => {});
        }
        db.prepare('UPDATE folders SET uidvalidity = ?, last_uid = 0 WHERE id = ?').run(
          uidvalidity,
          folder.id
        );
        lastUid = 0;
      }

      let range = null;
      let useUidRange = false;
      if (!lastUid && box.exists > 0) {
        const start = Math.max(1, box.exists - config.syncBackfillCount + 1);
        range = `${start}:*`;
      } else if (lastUid && box.exists > 0) {
        range = `${lastUid + 1}:*`;
        useUidRange = true;
      }

      if (range) {
        for await (const msg of client.fetch(
          range,
          { uid: true, source: true, flags: true, size: true },
          useUidRange ? { uid: true } : {}
        )) {
          if (lastUid && msg.uid <= lastUid) continue;

          const dup = db
            .prepare('SELECT id FROM mails WHERE mailbox_id = ? AND folder_id = ? AND uid = ?')
            .get(mailbox.id, folder.id, msg.uid);
          if (dup) continue;

          let parsed;
          try {
            parsed = await simpleParser(msg.source);
          } catch {
            parsed = { subject: '(解析失败)', text: '' };
          }

          const messageId = normalizeMessageId(parsed.messageId);
          if (messageId) {
            const sameMsg = db
              .prepare(
                'SELECT id FROM mails WHERE mailbox_id = ? AND folder_id = ? AND message_id = ?'
              )
              .get(mailbox.id, folder.id, messageId);
            if (sameMsg) continue;
          }

          const { id: mailId, isNew } = insertMail(mailbox, folder, msg, parsed);
          if (msg.uid > lastUid) lastUid = msg.uid;

          if (isNew) {
            const mailRow = db.prepare('SELECT * FROM mails WHERE id = ?').get(mailId);
            decidePushForMail(mailbox, mailRow);
          }
        }
      }

      db.prepare('UPDATE folders SET last_uid = ?, uidvalidity = ?, updated_at = ? WHERE id = ?').run(
        lastUid,
        uidvalidity,
        now,
        folder.id
      );
    }

    touchMailboxStatus(mailbox.id, 'ok', null);
    db.prepare('UPDATE mailboxes SET last_sync_at = ? WHERE id = ?').run(now, mailbox.id);
  } catch (err) {
    touchMailboxStatus(mailbox.id, 'error', err.message);
    throw err;
  } finally {
    if (client) await safeLogout(client);
  }
}
