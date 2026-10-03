import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { db } from '../db.js';
import { getCredentials } from './mailboxAuth.js';
import { getSentFolderId, openConnection } from './imap.js';

export async function buildTransport(mailbox) {
  const creds = await getCredentials(mailbox);
  const auth = creds.accessToken
    ? { type: 'OAuth2', user: creds.user, accessToken: creds.accessToken }
    : creds;
  return {
    transporter: nodemailer.createTransport({
      host: mailbox.smtp_host,
      port: mailbox.smtp_port || 465,
      secure: Boolean(mailbox.smtp_secure),
      auth,
      connectionTimeout: 30000,
      greetingTimeout: 30000,
      socketTimeout: 60000,
    }),
    creds,
  };
}

export async function verifySmtp(mailbox) {
  try {
    const { transporter } = await buildTransport(mailbox);
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function parseAddressList(input) {
  const list = String(input || '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return list;
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim();
}

export async function sendMail(mailbox, { to, cc, subject, text, html, attachments }) {
  const toList = parseAddressList(to);
  if (!toList.length) throw new Error('收件人不能为空');
  const ccList = parseAddressList(cc);

  const htmlContent = String(html || '').trim();
  const textContent = String(text || '').trim() || (htmlContent ? htmlToText(htmlContent) : '');

  const mailOptions = {
    from: mailbox.email,
    to: toList.join(', '),
    cc: ccList.length ? ccList.join(', ') : undefined,
    subject: subject || '',
    text: textContent,
    html: htmlContent || undefined,
    attachments: (attachments || []).map((a) => ({
      filename: a.originalname || a.filename,
      content: a.buffer,
      contentType: a.mimetype,
    })),
  };

  const composer = new MailComposer(mailOptions);
  const raw = await composer.compile().build();

  const { transporter } = await buildTransport(mailbox);
  const info = await transporter.sendMail({
    raw,
    envelope: { from: mailbox.email, to: [...toList, ...ccList] },
  });

  const sentFolderId = getSentFolderId(mailbox.id);
  const now = Date.now();
  const dateMatch = raw.toString('utf8').match(/^Date:\s*(.+)$/mi);
  const sentDate = dateMatch ? Date.parse(dateMatch[1]) : now;

  db.prepare(
    `INSERT INTO mails(mailbox_id, folder_id, uid, message_id, subject, from_name, from_addr,
      to_list, cc_list, date, snippet, body_text, body_html, flags, seen, size, has_attachments, created_at)
     VALUES(?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
  ).run(
    mailbox.id,
    sentFolderId,
    info.messageId || null,
    subject || '',
    mailbox.name,
    mailbox.email,
    toList.join(', '),
    ccList.length ? ccList.join(', ') : null,
    Number.isFinite(sentDate) ? sentDate : now,
    textContent.replace(/\s+/g, ' ').trim().slice(0, 200),
    textContent,
    htmlContent || null,
    JSON.stringify(['\\Seen']),
    Buffer.byteLength(raw),
    attachments && attachments.length ? 1 : 0,
    now
  );

  appendToSentInBackground(mailbox, sentFolderId, raw, info.messageId);

  return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
}

async function appendToSentInBackground(mailbox, sentFolderId, raw, messageId) {
  if (['gmail', 'outlook'].includes(mailbox.provider)) {
    return;
  }
  let client;
  try {
    client = await openConnection(mailbox);
    const folderRow = db.prepare('SELECT * FROM folders WHERE id = ?').get(sentFolderId);
    if (folderRow) {
      const result = await client.append(folderRow.path, raw, ['\\Seen']);
      if (result && result.uid && messageId) {
        db.prepare('UPDATE mails SET uid = ? WHERE folder_id = ? AND uid IS NULL AND message_id = ?').run(
          result.uid,
          sentFolderId,
          messageId
        );
      }
    }
  } catch (err) {
    console.error('[smtp] 追加到已发送失败(本地副本保留):', err.message);
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
