import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { db, getMailbox } from '../db.js';
import { config } from '../config.js';
import { signShareToken } from '../crypto.js';
import { openConnection, findSpecialFolder } from '../services/imap.js';
import { sendMail } from '../services/smtp.js';

export const mailsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
});

function getMail(id) {
  return db.prepare('SELECT * FROM mails WHERE id = ?').get(Number(id)) || null;
}

function getFolder(id) {
  return db.prepare('SELECT * FROM folders WHERE id = ?').get(Number(id)) || null;
}

function parseReferences(value) {
  if (!value) return [];
  try {
    const arr = JSON.parse(value);
    if (Array.isArray(arr)) return arr.map(String);
  } catch {
    /* fall back to whitespace-separated parsing */
  }
  return String(value).split(/\s+/).filter(Boolean);
}

function parseCursor(value) {
  if (!value) return null;
  const [dateStr, idStr] = String(value).split(':');
  const date = Number(dateStr);
  const id = Number(idStr);
  if (!Number.isFinite(date) || !Number.isFinite(id)) return null;
  return { date, id };
}

mailsRouter.get('/', (req, res) => {
  const { mailboxId, folderId, seen, scope } = req.query;

  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));

  const before = parseCursor(req.query.before);
  const after = parseCursor(req.query.after);
  const cursor = before ? { ...before, dir: 'before' } : after ? { ...after, dir: 'after' } : null;

  const isMerged = scope === 'merged-inbox';
  const where = [];
  const params = [];

  if (isMerged) {
    where.push("(f.special_use = '\\Inbox' OR f.path = 'INBOX')");
  } else {
    if (!mailboxId) return res.status(400).json({ error: '缺少 mailboxId' });
    where.push('m.mailbox_id = ?');
    params.push(Number(mailboxId));
    if (folderId) {
      where.push('m.folder_id = ?');
      params.push(Number(folderId));
    }
  }
  if (seen === '0' || seen === '1') {
    where.push('m.seen = ?');
    params.push(Number(seen));
  }

  const countJoin = isMerged ? 'JOIN folders f ON f.id = m.folder_id' : '';
  const listJoin = isMerged
    ? `JOIN folders f ON f.id = m.folder_id
       JOIN mailboxes mb ON mb.id = m.mailbox_id`
    : '';
  const columns = isMerged
    ? `m.id, m.uid, m.subject, m.from_name, m.from_addr, m.date, m.snippet, m.seen,
       m.has_attachments, m.size, m.folder_id, m.mailbox_id, mb.name AS mailbox_name`
    : `m.id, m.uid, m.subject, m.from_name, m.from_addr, m.date, m.snippet, m.seen,
       m.has_attachments, m.size, m.folder_id`;

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM mails m ${countJoin} WHERE ${where.join(' AND ')}`)
    .get(...params);

  const itemWhere = [...where];
  const itemParams = [...params];
  let orderDir = 'DESC';
  let limitClause = 'LIMIT ? OFFSET ?';

  if (cursor) {
    if (cursor.dir === 'before') {
      itemWhere.push('(COALESCE(m.date, 0) < ? OR (COALESCE(m.date, 0) = ? AND m.id < ?))');
      itemParams.push(cursor.date, cursor.date, cursor.id);
    } else {
      itemWhere.push('(COALESCE(m.date, 0) > ? OR (COALESCE(m.date, 0) = ? AND m.id > ?))');
      itemParams.push(cursor.date, cursor.date, cursor.id);
      orderDir = 'ASC';
    }
    limitClause = 'LIMIT ?';
    itemParams.push(pageSize);
  } else {
    itemParams.push(pageSize, (page - 1) * pageSize);
  }

  const items = db
    .prepare(
      `SELECT ${columns}
       FROM mails m ${listJoin}
       WHERE ${itemWhere.join(' AND ')}
       ORDER BY COALESCE(m.date, 0) ${orderDir}, m.id ${orderDir} ${limitClause}`
    )
    .all(...itemParams);

  if (cursor && cursor.dir === 'after') items.reverse();

  res.json({ total: totalRow.n, page, pageSize, items });
});

mailsRouter.get('/:id', (req, res) => {
  const mail = getMail(req.params.id);
  if (!mail) return res.status(404).json({ error: '邮件不存在' });
  const attachments = db
    .prepare('SELECT id, filename, content_type, size FROM attachments WHERE mail_id = ?')
    .all(mail.id);
  res.json({
    id: mail.id,
    mailboxId: mail.mailbox_id,
    folderId: mail.folder_id,
    uid: mail.uid,
    messageId: mail.message_id,
    inReplyTo: mail.in_reply_to,
    references: parseReferences(mail.reference_ids),
    subject: mail.subject,
    fromName: mail.from_name,
    fromAddr: mail.from_addr,
    senderName: mail.sender_name,
    senderAddr: mail.sender_addr,
    replyToName: mail.reply_to_name,
    replyToAddr: mail.reply_to_addr,
    toList: mail.to_list,
    ccList: mail.cc_list,
    date: mail.date,
    bodyText: mail.body_text,
    bodyHtml: mail.body_html,
    seen: Boolean(mail.seen),
    hasAttachments: Boolean(mail.has_attachments),
    attachments,
  });
});

mailsRouter.get('/:id/attachments/:attachmentId', (req, res) => {
  const mail = getMail(req.params.id);
  if (!mail) return res.status(404).json({ error: '邮件不存在' });
  const att = db
    .prepare('SELECT * FROM attachments WHERE id = ? AND mail_id = ?')
    .get(Number(req.params.attachmentId), mail.id);
  if (!att) return res.status(404).json({ error: '附件不存在' });
  if (!fs.existsSync(att.path)) return res.status(404).json({ error: '附件文件已丢失' });
  res.setHeader('Content-Type', att.content_type || 'application/octet-stream');
  const encoded = encodeURIComponent(att.filename || 'attachment');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encoded}`
  );
  const stream = fs.createReadStream(att.path);
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).json({ error: '附件文件已丢失' });
    else res.destroy();
  });
  stream.pipe(res);
});

mailsRouter.post('/:id/share', (req, res) => {
  const mail = getMail(req.params.id);
  if (!mail) return res.status(404).json({ error: '邮件不存在' });
  const ttlSeconds = config.shareTtlHours > 0 ? Math.floor(config.shareTtlHours * 3600) : 0;
  const token = signShareToken(mail.id, ttlSeconds);
  res.json({
    token,
    path: `/share/${token}`,
    expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
  });
});

async function syncSeenToImap(rows, seen) {
  const warnings = [];
  const byFolder = new Map();
  for (const row of rows) {
    if (!row.uid) continue;
    if (!byFolder.has(row.folder_id)) byFolder.set(row.folder_id, []);
    byFolder.get(row.folder_id).push(row);
  }
  for (const [folderIdKey, mails] of byFolder) {
    const folder = getFolder(folderIdKey);
    const mailbox = folder ? getMailbox(folder.mailbox_id) : null;
    if (!folder || !mailbox) continue;
    let client;
    try {
      client = await openConnection(mailbox);
      await client.mailboxOpen(folder.path);
      const uids = mails.map((m) => m.uid);
      if (seen) await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
      else await client.messageFlagsRemove(uids, ['\\Seen'], { uid: true });
    } catch (err) {
      warnings.push(err.message);
    } finally {
      if (client) {
        try {
          if (client.usable) await client.logout();
          else client.close();
        } catch {
          /* ignore */
        }
      }
    }
  }
  return warnings;
}

async function applySeenOnImap(mailbox, folder, uid, seen) {
  let client;
  try {
    client = await openConnection(mailbox);
    await client.mailboxOpen(folder.path);
    const flagOp = seen ? client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }) : client.messageFlagsRemove(uid, ['\\Seen'], { uid: true });
    await flagOp;
    return null;
  } catch (err) {
    return err.message;
  } finally {
    if (client) {
      try {
        if (client.usable) await client.logout();
        else client.close();
      } catch {
        /* ignore */
      }
    }
  }
}

mailsRouter.patch('/:id', async (req, res) => {
  const mail = getMail(req.params.id);
  if (!mail) return res.status(404).json({ error: '邮件不存在' });
  const { seen } = req.body || {};
  if (typeof seen !== 'boolean') return res.status(400).json({ error: 'seen 必须为布尔值' });

  db.prepare('UPDATE mails SET seen = ? WHERE id = ?').run(seen ? 1 : 0, mail.id);

  const mailbox = getMailbox(mail.mailbox_id);
  const folder = getFolder(mail.folder_id);
  let warning = null;
  if (mailbox && folder && mail.uid) {
    warning = await applySeenOnImap(mailbox, folder, mail.uid, seen);
  }
  res.json({ ok: true, warning });
});

mailsRouter.post('/seen-all', async (req, res) => {
  const { mailboxId, folderId, scope } = req.body || {};
  const isMerged = scope === 'merged-inbox';
  const where = ['m.seen = 0'];
  const params = [];

  if (isMerged) {
    where.push("(f.special_use = '\\Inbox' OR f.path = 'INBOX')");
  } else {
    if (!mailboxId) return res.status(400).json({ error: '缺少 mailboxId' });
    where.push('m.mailbox_id = ?');
    params.push(Number(mailboxId));
    if (folderId) {
      where.push('m.folder_id = ?');
      params.push(Number(folderId));
    }
  }

  const join = isMerged ? 'JOIN folders f ON f.id = m.folder_id' : '';
  const rows = db
    .prepare(`SELECT m.id, m.uid, m.folder_id FROM mails m ${join} WHERE ${where.join(' AND ')}`)
    .all(...params);

  if (!rows.length) return res.json({ ok: true, updated: 0, warnings: [] });

  const placeholders = rows.map(() => '?').join(',');
  db.prepare(`UPDATE mails SET seen = 1 WHERE id IN (${placeholders})`).run(...rows.map((r) => r.id));

  const warnings = await syncSeenToImap(rows, true);
  res.json({ ok: true, updated: rows.length, warnings });
});

mailsRouter.post('/batch', async (req, res) => {
  const { ids, action, folderId, permanent } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids 不能为空' });
  if (!['seen', 'unseen', 'move', 'delete'].includes(action)) {
    return res.status(400).json({ error: 'action 必须是 seen/unseen/move/delete' });
  }

  const warnings = [];
  const mailIds = ids.map(Number);

  if (action === 'seen' || action === 'unseen') {
    const seen = action === 'seen';
    const placeholders = mailIds.map(() => '?').join(',');
    db.prepare(`UPDATE mails SET seen = ? WHERE id IN (${placeholders})`).run(seen ? 1 : 0, ...mailIds);

    const rows = db
      .prepare(`SELECT * FROM mails WHERE id IN (${placeholders}) AND uid IS NOT NULL`)
      .all(...mailIds);
    warnings.push(...(await syncSeenToImap(rows, seen)));
    return res.json({ ok: true, warnings });
  }

  if (action === 'move') {
    if (!folderId) return res.status(400).json({ error: '移动操作需要 folderId' });
    const destFolder = getFolder(folderId);
    if (!destFolder) return res.status(404).json({ error: '目标文件夹不存在' });

    for (const mailId of mailIds) {
      const mail = getMail(mailId);
      if (!mail) continue;
      const folder = getFolder(mail.folder_id);
      const mailbox = folder ? getMailbox(folder.mailbox_id) : null;
      if (!folder || !mailbox) continue;
      if (folder.id === destFolder.id) continue;
      if (destFolder.mailbox_id !== mailbox.id) {
        warnings.push(`邮件 ${mail.id} 与目标文件夹不属于同一邮箱，已跳过`);
        continue;
      }

      db.prepare('UPDATE mails SET folder_id = ? WHERE id = ?').run(destFolder.id, mail.id);

      if (mail.uid) {
        let client;
        try {
          client = await openConnection(mailbox);
          await client.mailboxOpen(folder.path);
          const result = await client.messageMove(mail.uid, destFolder.path, { uid: true });
          const newUid = result?.uidMap?.get(mail.uid);
          if (newUid) {
            db.prepare('UPDATE mails SET uid = ? WHERE id = ?').run(Number(newUid), mail.id);
          } else {
            db.prepare('DELETE FROM mails WHERE id = ?').run(mail.id);
          }
        } catch (err) {
          db.prepare('UPDATE mails SET folder_id = ? WHERE id = ?').run(folder.id, mail.id);
          warnings.push(err.message);
        } finally {
          if (client) {
            try {
              if (client.usable) await client.logout();
              else client.close();
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
    return res.json({ ok: true, warnings });
  }

  if (action === 'delete') {
    for (const mailId of mailIds) {
      const mail = getMail(mailId);
      if (!mail) continue;
      const folder = getFolder(mail.folder_id);
      const mailbox = folder ? getMailbox(folder.mailbox_id) : null;
      if (!folder || !mailbox) {
        db.prepare('DELETE FROM mails WHERE id = ?').run(mail.id);
        continue;
      }

      const trash = findSpecialFolder(mailbox.id, '\\Trash');
      const inTrash = folder.special_use === '\\Trash';
      const forcePermanent = permanent === true;
      const permanentDelete = inTrash || !trash || forcePermanent;

      if (!permanentDelete) {
        db.prepare('UPDATE mails SET folder_id = ? WHERE id = ?').run(trash.id, mail.id);
      } else {
        db.prepare('DELETE FROM mails WHERE id = ?').run(mail.id);
        const attDir = path.join(config.dataDir, 'attachments', String(mail.id));
        fs.rm(attDir, { recursive: true, force: true }, () => {});
      }

      if (mail.uid) {
        let client;
        try {
          client = await openConnection(mailbox);
          await client.mailboxOpen(folder.path);
          if (!permanentDelete && trash) {
            const result = await client.messageMove(mail.uid, trash.path, { uid: true });
            const newUid = result?.uidMap?.get(mail.uid);
            if (newUid) {
              db.prepare('UPDATE mails SET uid = ? WHERE id = ?').run(Number(newUid), mail.id);
            } else {
              db.prepare('DELETE FROM mails WHERE id = ?').run(mail.id);
            }
          } else {
            await client.messageDelete(mail.uid, { uid: true });
          }
        } catch (err) {
          warnings.push(err.message);
        } finally {
          if (client) {
            try {
              if (client.usable) await client.logout();
              else client.close();
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
    return res.json({ ok: true, warnings });
  }
});

function parseReferencesField(value) {
  const text = String(value || '').trim();
  if (!text) return undefined;
  if (text.startsWith('[')) {
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) return arr;
    } catch {
      /* fall back to whitespace-separated parsing */
    }
  }
  return text;
}

mailsRouter.post('/send', upload.array('attachments', 10), async (req, res) => {
  const { mailboxId, to, cc, subject, text, html, replyTo, inReplyTo, references, sender } = req.body || {};
  if (!mailboxId) return res.status(400).json({ error: '缺少 mailboxId' });
  const mailbox = getMailbox(mailboxId);
  if (!mailbox) return res.status(404).json({ error: '邮箱不存在' });
  try {
    const result = await sendMail(mailbox, {
      to,
      cc,
      subject,
      text,
      html,
      replyTo,
      inReplyTo,
      references: parseReferencesField(references),
      sender,
      attachments: req.files || [],
    });
    res.json({ ok: true, messageId: result.messageId });
  } catch (err) {
    res.status(500).json({ error: `发送失败: ${err.message}` });
  }
});
