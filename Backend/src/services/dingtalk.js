import crypto from 'node:crypto';
import { db, getSetting } from '../db.js';
import { decryptText } from '../crypto.js';
import { config } from '../config.js';

const PUSH_INTERVAL_MS = 3100;

export function getDingtalkConfig() {
  let webhook = getSetting('dingtalk_webhook');
  let secret = getSetting('dingtalk_secret_enc');
  let enabled = getSetting('dingtalk_enabled');
  return {
    webhook: webhook !== null && webhook !== '' ? webhook : config.dingtalkWebhook,
    secret: secret ? decryptText(secret) : config.dingtalkSecret,
    enabled: enabled === null ? false : enabled === '1',
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

export async function sendMarkdown(title, text) {
  const { webhook, secret } = getDingtalkConfig();
  if (!webhook) throw new Error('钉钉 webhook 未配置');
  const resp = await fetch(signedUrl(webhook, secret), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'markdown', markdown: { title, text } }),
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
        await sendMarkdown(task.title, task.text);
      } catch (err) {
        console.error('[dingtalk] 推送失败:', err.message);
      }
      if (queue.length) await sleep(PUSH_INTERVAL_MS);
    }
  } finally {
    draining = false;
  }
}

export function enqueueMarkdown(title, text) {
  queue.push({ title, text });
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
  const from = mail.from_addr ? `${mail.from_name || ''} <${mail.from_addr}>` : mail.from_name || '未知';
  const time = mail.date ? new Date(mail.date).toLocaleString('zh-CN') : '';
  const text = [
    `### 新邮件`,
    ``,
    `- **邮箱**: ${mailbox.name}`,
    `- **发件人**: ${from}`,
    `- **主题**: ${mail.subject || '(无主题)'}`,
    `- **时间**: ${time}`,
    ``,
    mail.snippet ? `> ${mail.snippet}` : '',
  ].join('\n');
  enqueueMarkdown(`新邮件: ${mail.subject || '(无主题)'}`, text);
  return true;
}
