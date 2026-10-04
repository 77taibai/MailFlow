import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { db } from '../db.js';
import { getCredentials } from './mailboxAuth.js';
import { getSentFolderId, openConnection } from './imap.js';
import { normalizeMessageId, normalizeReferences } from './mailHeaders.js';

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

function splitAddress(value) {
  const text = String(value || '').trim();
  if (!text) return { name: null, address: null };
  const match = text.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1].replace(/^["']|["']$/g, '').trim();
    const address = match[2].trim();
    return { name: name || null, address: address || null };
  }
  return { name: null, address: text };
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

export async function sendMail(
  mailbox,
  { to, cc, subject, text, html, attachments, replyTo, inReplyTo, references, sender, messageId, date }
) {
  const toList = parseAddressList(to);
  if (!toList.length) throw new Error('收件人不能为空');
  const ccList = parseAddressList(cc);
  const refList = normalizeReferences(references);
  const inReplyToId = normalizeMessageId(inReplyTo);
  const messageIdValue = normalizeMessageId(messageId);
  const replyToText = String(replyTo || '').trim();
  const senderText = String(sender || '').trim();
  const senderValue =
    senderText && senderText.toLowerCase() !== String(mailbox.email || '').toLowerCase()
      ? senderText
      : '';
  const replyParts = splitAddress(replyToText);
  const senderParts = splitAddress(senderValue);
  const fromName = String(mailbox.sender_name || '').trim();
  const fromValue = fromName ? { name: fromName, address: mailbox.email } : mailbox.email;

  const htmlContent = String(html || '').trim();
  const textContent = String(text || '').trim() || (htmlContent ? htmlToText(htmlContent) : '');

  const mailOptions = {
    from: fromValue,
    sender: senderValue || undefined,
    replyTo: replyToText || undefined,
    inReplyTo: inReplyToId || undefined,
    references: refList.length ? refList : undefined,
    messageId: messageIdValue || undefined,
    date: date || undefined,
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
    `INSERT INTO mails(mailbox_id, folder_id, uid, message_id, in_reply_to, reference_ids, subject, from_name, from_addr,
      sender_name, sender_addr, reply_to_name, reply_to_addr, to_list, cc_list, date, snippet, body_text, body_html,
      flags, seen, size, has_attachments, created_at)
     VALUES(?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
  ).run(
    mailbox.id,
    sentFolderId,
    info.messageId || messageIdValue || null,
    inReplyToId,
    refList.length ? JSON.stringify(refList) : null,
    subject || '',
    fromName || null,
    mailbox.email,
    senderParts.name,
    senderParts.address,
    replyParts.name,
    replyParts.address,
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
