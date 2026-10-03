import { Router } from 'express';
import fs from 'node:fs';
import { db } from '../db.js';
import { verifyShareToken } from '../crypto.js';

export const shareRouter = Router();

function resolveSharedMail(req, res) {
  let info;
  try {
    info = verifyShareToken(String(req.params.token || ''));
  } catch {
    res.status(404).json({ error: '分享链接无效或已过期' });
    return null;
  }
  const mail = db.prepare('SELECT * FROM mails WHERE id = ?').get(info.mailId) || null;
  if (!mail) {
    res.status(404).json({ error: '邮件不存在' });
    return null;
  }
  return mail;
}

shareRouter.get('/:token', (req, res) => {
  const mail = resolveSharedMail(req, res);
  if (!mail) return;
  const attachments = db
    .prepare('SELECT id, filename, content_type, size FROM attachments WHERE mail_id = ?')
    .all(mail.id);
  res.json({
    id: mail.id,
    subject: mail.subject,
    fromName: mail.from_name,
    fromAddr: mail.from_addr,
    toList: mail.to_list,
    ccList: mail.cc_list,
    date: mail.date,
    bodyText: mail.body_text,
    bodyHtml: mail.body_html,
    attachments,
  });
});

shareRouter.get('/:token/attachments/:attachmentId', (req, res) => {
  const mail = resolveSharedMail(req, res);
  if (!mail) return;
  const att = db
    .prepare('SELECT * FROM attachments WHERE id = ? AND mail_id = ?')
    .get(Number(req.params.attachmentId), mail.id);
  if (!att) return res.status(404).json({ error: '附件不存在' });
  if (!fs.existsSync(att.path)) return res.status(404).json({ error: '附件文件已丢失' });
  res.setHeader('Content-Type', att.content_type || 'application/octet-stream');
  const encoded = encodeURIComponent(att.filename || 'attachment');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encoded}`);
  const stream = fs.createReadStream(att.path);
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).json({ error: '附件文件已丢失' });
    else res.destroy();
  });
  stream.pipe(res);
});
