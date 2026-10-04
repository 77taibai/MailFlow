import crypto from 'node:crypto';
import { db } from '../db.js';
import { config } from '../config.js';
import { signShareToken } from '../crypto.js';

const PUSH_INTERVAL_MS = 3100;

export function getDingtalkConfig() {
  return {
    webhook: config.dingtalkWebhook,
    secret: config.dingtalkSecret,
    enabled: Boolean(config.dingtalkWebhook),
  };
}

function signedUrl(webhook, secret) {
  if (!secret) return webhook;
  const ts = Date.now();
  const stringToSign = `${ts}\n${secret}`;
  const sign = encodeURIComponent(
    crypto.createHmac('sha256', secret).update(stringToSign).digest('base64')
  );
  const sep = webhook.includes('?') ? '&' : '?';
  return `${webhook}${sep}timestamp=${ts}&sign=${sign}`;
}

export async function sendActionCard(card) {
  const { webhook, secret } = getDingtalkConfig();
  if (!webhook) throw new Error('钉钉 webhook 未配置');
  const resp = await fetch(signedUrl(webhook, secret), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'actionCard',
      actionCard: {
        title: card.title,
        text: card.text,
        btnOrientation: '0',
        singleTitle: card.singleTitle || '阅读邮件',
        singleURL: card.singleURL,
      },
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (data.errcode !== 0) {
    throw new Error(`钉钉推送失败: ${data.errmsg || `HTTP ${resp.status}`}`);
  }
  return data;
}

const queue = [];
let draining = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const task = queue.shift();
      try {
        await sendActionCard(task);
      } catch (err) {
        console.error('[dingtalk] 推送失败:', err.message);
      }
      if (queue.length) await sleep(PUSH_INTERVAL_MS);
    }
  } finally {
    draining = false;
  }
}

export function enqueueActionCard(card) {
  queue.push(card);
  drain();
}

export function mailMatchesPushRules(mailbox, mail) {
  const { enabled, webhook } = getDingtalkConfig();
  if (!enabled || !webhook) return false;
  if (!mailbox.dingtalk_enabled) return false;
  if (mail.seen) return false;
  if (mail.dingtalk_pushed) return false;

  const maxAgeMs = config.pushMaxAgeHours * 3600 * 1000;
  if (!mail.date || Date.now() - mail.date > maxAgeMs) return false;

  const include = String(mailbox.dingtalk_include || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const exclude = String(mailbox.dingtalk_exclude || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const subject = String(mail.subject || '');
  if (include.length && !include.some((kw) => subject.includes(kw))) return false;
  if (exclude.length && exclude.some((kw) => subject.includes(kw))) return false;

  return true;
}

export function decidePushForMail(mailbox, mail) {
  if (!mailMatchesPushRules(mailbox, mail)) return false;
  db.prepare('UPDATE mails SET dingtalk_pushed = 1 WHERE id = ?').run(mail.id);

  const subject = mail.subject || '(无主题)';
  const from = mail.from_name || mail.from_addr || '未知';
  const recipient = mailbox.name || mailbox.email || '';

  const ttlSeconds = config.shareTtlHours > 0 ? Math.floor(config.shareTtlHours * 3600) : 0;
  const token = signShareToken(mail.id, ttlSeconds);
  const link = `${config.appUrl}/share/${token}`;

  const text = [`### ${subject}`, `发件人：**${from}**`, '', `收件人：**${recipient}**`].join('\n');

  enqueueActionCard({
    title: subject,
    text,
    singleTitle: '阅读邮件',
    singleURL: link,
  });
  return true;
}
