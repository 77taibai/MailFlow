import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, listMailboxes, getMailbox } from '../db.js';
import { config, oauthProviderEnabled } from '../config.js';
import { encryptText, signToken, verifyToken } from '../crypto.js';
import { PROVIDERS, buildAuthRedirect, exchangeCode, getUserEmail, claimsToEmail } from '../services/oauth.js';
import { testImap } from '../services/imap.js';
import { verifySmtp } from '../services/smtp.js';
import { syncOne, syncingIds } from '../services/scheduler.js';

export const mailboxesRouter = Router();

const PROVIDER_DEFAULTS = {
  gmail: { imapHost: 'imap.gmail.com', imapPort: 993, imapSecure: 1, smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: 1 },
  outlook: { imapHost: 'outlook.office365.com', imapPort: 993, imapSecure: 1, smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecure: 0 },
};

function now() {
  return Date.now();
}

function deleteAttachmentDirs(mailboxId) {
  const rows = db.prepare('SELECT id FROM mails WHERE mailbox_id = ?').all(mailboxId);
  for (const row of rows) {
    const dir = path.join(config.dataDir, 'attachments', String(row.id));
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
}

mailboxesRouter.get('/', (req, res) => {
  const mailboxes = listMailboxes();
  const unread = db
    .prepare('SELECT mailbox_id, COUNT(*) AS n FROM mails WHERE seen = 0 GROUP BY mailbox_id')
    .all();
  const total = db
    .prepare('SELECT mailbox_id, COUNT(*) AS n FROM mails GROUP BY mailbox_id')
    .all();
  const unreadMap = Object.fromEntries(unread.map((r) => [r.mailbox_id, r.n]));
  const totalMap = Object.fromEntries(total.map((r) => [r.mailbox_id, r.n]));
  const oauth = {
    gmail: oauthProviderEnabled('gmail'),
    outlook: oauthProviderEnabled('outlook'),
  };
  const mergedUnread = db
    .prepare(
      `SELECT COUNT(*) AS n FROM mails m JOIN folders f ON f.id = m.folder_id
       WHERE m.seen = 0 AND (f.special_use = '\\Inbox' OR f.path = 'INBOX')`
    )
    .get().n;
  res.json({
    items: mailboxes.map((mb) => ({
      id: mb.id,
      name: mb.name,
      senderName: mb.sender_name,
      email: mb.email,
      provider: mb.provider,
      authType: mb.auth_type,
      imapHost: mb.imap_host,
      imapPort: mb.imap_port,
      imapSecure: Boolean(mb.imap_secure),
      smtpHost: mb.smtp_host,
      smtpPort: mb.smtp_port,
      smtpSecure: Boolean(mb.smtp_secure),
      username: mb.username,
      syncIntervalSec: mb.sync_interval_sec,
      dingtalkEnabled: Boolean(mb.dingtalk_enabled),
      dingtalkInclude: mb.dingtalk_include,
      dingtalkExclude: mb.dingtalk_exclude,
      status: mb.status,
      lastError: mb.last_error,
      lastSyncAt: mb.last_sync_at,
      unreadCount: unreadMap[mb.id] || 0,
      totalCount: totalMap[mb.id] || 0,
    })),
    oauth,
    mergedUnread,
  });
});

// 供前端轮询：当前正在后台同步的邮箱 id。放在动态 :id 路由之前避免歧义。
mailboxesRouter.get('/sync-status', (req, res) => {
  res.json({ ids: syncingIds() });
});

function validateMailboxPayload(body) {
  const required = ['name', 'email', 'imapHost', 'imapPort', 'smtpHost', 'smtpPort', 'username'];
  for (const key of required) {
    if (!body[key] && body[key] !== 0) throw new Error(`缺少必填字段: ${key}`);
  }
  if (body.authType && !['password', 'oauth2'].includes(body.authType)) {
    throw new Error('authType 必须是 password 或 oauth2');
  }
}

function isPasswordAttemptForOAuthProvider(provider, authType) {
  return ['gmail', 'outlook'].includes(provider) && (authType || 'password') === 'password';
}

mailboxesRouter.post('/', (req, res) => {
  const body = req.body || {};
  try {
    validateMailboxPayload(body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (['gmail', 'outlook'].includes(body.provider || '')) {
    return res
      .status(400)
      .json({ error: 'Gmail/Outlook 请使用 OAuth 授权添加，无需填写服务器地址与密码' });
  }
  const authType = body.authType || 'password';
  if (authType === 'password' && !body.password) {
    return res.status(400).json({ error: 'password 认证方式必须提供密码' });
  }
  const t = now();
  const info = db
    .prepare(
      `INSERT INTO mailboxes(name, sender_name, email, provider, auth_type, imap_host, imap_port, imap_secure,
        smtp_host, smtp_port, smtp_secure, username, password_enc, sync_interval_sec,
        dingtalk_enabled, dingtalk_include, dingtalk_exclude, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      body.name,
      body.senderName ? String(body.senderName).trim() || null : null,
      body.email,
      body.provider || 'custom',
      authType,
      body.imapHost,
      Number(body.imapPort),
      body.imapSecure === false ? 0 : 1,
      body.smtpHost,
      Number(body.smtpPort),
      body.smtpSecure === false ? 0 : 1,
      body.username,
      authType === 'password' ? encryptText(body.password) : null,
      body.syncIntervalSec ? Number(body.syncIntervalSec) : null,
      body.dingtalkEnabled ? 1 : 0,
      body.dingtalkInclude || '',
      body.dingtalkExclude || '',
      t,
      t
    );
  res.json({ id: Number(info.lastInsertRowid) });
});

mailboxesRouter.put('/:id', (req, res) => {
  const mb = getMailbox(req.params.id);
  if (!mb) return res.status(404).json({ error: '邮箱不存在' });
  const body = req.body || {};
  const existing = {
    name: mb.name,
    email: mb.email,
    imapHost: mb.imap_host,
    imapPort: mb.imap_port,
    smtpHost: mb.smtp_host,
    smtpPort: mb.smtp_port,
    username: mb.username,
  };
  try {
    validateMailboxPayload({ ...existing, ...body });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const sets = [];
  const params = [];
  const fields = {
    name: body.name,
    senderName: body.senderName !== undefined ? String(body.senderName).trim() || null : undefined,
    email: body.email,
    imapHost: body.imapHost,
    imapPort: body.imapPort !== undefined ? Number(body.imapPort) : undefined,
    imapSecure: body.imapSecure !== undefined ? (body.imapSecure ? 1 : 0) : undefined,
    smtpHost: body.smtpHost,
    smtpPort: body.smtpPort !== undefined ? Number(body.smtpPort) : undefined,
    smtpSecure: body.smtpSecure !== undefined ? (body.smtpSecure ? 1 : 0) : undefined,
    username: body.username,
    syncIntervalSec: body.syncIntervalSec !== undefined ? (body.syncIntervalSec ? Number(body.syncIntervalSec) : null) : undefined,
    dingtalkEnabled: body.dingtalkEnabled !== undefined ? (body.dingtalkEnabled ? 1 : 0) : undefined,
    dingtalkInclude: body.dingtalkInclude,
    dingtalkExclude: body.dingtalkExclude,
  };
  const columnMap = {
    name: 'name',
    senderName: 'sender_name',
    email: 'email',
    imapHost: 'imap_host',
    imapPort: 'imap_port',
    imapSecure: 'imap_secure',
    smtpHost: 'smtp_host',
    smtpPort: 'smtp_port',
    smtpSecure: 'smtp_secure',
    username: 'username',
    syncIntervalSec: 'sync_interval_sec',
    dingtalkEnabled: 'dingtalk_enabled',
    dingtalkInclude: 'dingtalk_include',
    dingtalkExclude: 'dingtalk_exclude',
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      sets.push(`${columnMap[key]} = ?`);
      params.push(value);
    }
  }
  if (body.password) {
    sets.push('password_enc = ?');
    params.push(encryptText(body.password));
  }
  if (!sets.length) return res.json({ ok: true });
  sets.push('updated_at = ?');
  params.push(now(), mb.id);
  db.prepare(`UPDATE mailboxes SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

mailboxesRouter.delete('/:id', (req, res) => {
  const mb = getMailbox(req.params.id);
  if (!mb) return res.status(404).json({ error: '邮箱不存在' });
  deleteAttachmentDirs(mb.id);
  db.prepare('DELETE FROM mailboxes WHERE id = ?').run(mb.id);
  res.json({ ok: true });
});

async function testMailbox(mb) {
  const imap = await testImap(mb);
  const smtp = await verifySmtp(mb);
  return { imap, smtp };
}

mailboxesRouter.post('/test', async (req, res) => {
  const body = req.body || {};
  try {
    validateMailboxPayload(body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (isPasswordAttemptForOAuthProvider(body.provider, body.authType)) {
    return res
      .status(400)
      .json({ error: 'Gmail/Outlook 请使用 OAuth 授权，无需测试密码连接' });
  }
  const transient = {
    imap_host: body.imapHost,
    imap_port: Number(body.imapPort),
    imap_secure: body.imapSecure === false ? 0 : 1,
    smtp_host: body.smtpHost,
    smtp_port: Number(body.smtpPort),
    smtp_secure: body.smtpSecure === false ? 0 : 1,
    username: body.username,
    email: body.email,
    auth_type: body.authType || 'password',
    password_enc: body.password ? encryptText(body.password) : null,
    provider: body.provider || 'custom',
  };
  res.json(await testMailbox(transient));
});

mailboxesRouter.post('/:id/test', async (req, res) => {
  const mb = getMailbox(req.params.id);
  if (!mb) return res.status(404).json({ error: '邮箱不存在' });
  res.json(await testMailbox(mb));
});

mailboxesRouter.post('/:id/sync', async (req, res) => {
  const mb = getMailbox(req.params.id);
  if (!mb) return res.status(404).json({ error: '邮箱不存在' });
  syncOne(mb.id);
  res.json({ started: true });
});

mailboxesRouter.get('/:id/folders', (req, res) => {
  const mbId = Number(req.params.id);
  const folders = db
    .prepare(
      `SELECT f.*,
        (SELECT COUNT(*) FROM mails m WHERE m.folder_id = f.id) AS total,
        (SELECT COUNT(*) FROM mails m WHERE m.folder_id = f.id AND m.seen = 0) AS unread
       FROM folders f WHERE f.mailbox_id = ? ORDER BY f.special_use IS NULL, f.path`
    )
    .all(mbId);
  res.json({
    items: folders.map((f) => ({
      id: f.id,
      path: f.path,
      specialUse: f.special_use,
      syncEnabled: Boolean(f.sync_enabled),
      unread: f.unread,
      total: f.total,
    })),
  });
});

mailboxesRouter.put('/:id/folders', (req, res) => {
  const { folderId, syncEnabled } = req.body || {};
  const folder = db
    .prepare('SELECT * FROM folders WHERE id = ? AND mailbox_id = ?')
    .get(Number(folderId), Number(req.params.id));
  if (!folder) return res.status(404).json({ error: '文件夹不存在' });
  db.prepare('UPDATE folders SET sync_enabled = ?, updated_at = ? WHERE id = ?').run(
    syncEnabled ? 1 : 0,
    now(),
    folder.id
  );
  res.json({ ok: true });
});

mailboxesRouter.get('/oauth/:provider/start', (req, res) => {
  const provider = req.params.provider;
  if (!PROVIDERS[provider]) return res.status(400).json({ error: '不支持的 OAuth 服务商' });
  if (!oauthProviderEnabled(provider)) {
    return res.status(400).json({ error: '该服务商 OAuth 未在 .env 中配置' });
  }
  const state = signToken({ t: 'mailbox-oauth', provider }, 600);
  const redirectUri = `${config.appUrl}/api/mailboxes/oauth/${provider}/callback`;
  const url = buildAuthRedirect(provider, redirectUri, state);
  res.json({ url: url.href });
});

export const mailboxesOAuthPublicRouter = Router();

mailboxesOAuthPublicRouter.get('/:provider/callback', async (req, res) => {
  const provider = req.params.provider;
  const frontend = config.frontendOrigin || config.appUrl;
  try {
    if (!PROVIDERS[provider]) throw new Error('不支持的 OAuth 服务商');

    let statePayload;
    try {
      statePayload = verifyToken(String(req.query.state || ''));
    } catch {
      throw new Error('state 校验失败，请重新发起授权');
    }
    if (!statePayload || statePayload.t !== 'mailbox-oauth' || statePayload.provider !== provider) {
      throw new Error('state 校验失败，请重新发起授权');
    }

    const code = String(req.query.code || '');
    if (!code) throw new Error('授权码缺失');
    const redirectUri = `${config.appUrl}/api/mailboxes/oauth/${provider}/callback`;
    const tokens = await exchangeCode(provider, code, redirectUri);
    const email =
      claimsToEmail(tokens.claims) || (await getUserEmail(provider, tokens.accessToken));
    if (!email) throw new Error('无法从服务商获取邮箱地址');

    const defaults = PROVIDER_DEFAULTS[provider];
    const existing = db
      .prepare(
        'SELECT id, imap_host, imap_port, smtp_host, smtp_port FROM mailboxes WHERE email = ?'
      )
      .get(email);

    const t = now();
    if (existing) {
      db.prepare(
        `UPDATE mailboxes SET auth_type = 'oauth2', provider = ?, access_token_enc = ?,
          refresh_token_enc = ?, token_expires_at = ?, scope = ?,
          imap_host = COALESCE(imap_host, ?), imap_port = COALESCE(imap_port, ?),
          smtp_host = COALESCE(smtp_host, ?), smtp_port = COALESCE(smtp_port, ?),
          username = COALESCE(username, ?), status = 'ok', last_error = NULL, updated_at = ?
         WHERE id = ?`
      ).run(
        provider,
        encryptText(tokens.accessToken),
        tokens.refreshToken ? encryptText(tokens.refreshToken) : null,
        tokens.expiresAt,
        tokens.scope,
        defaults.imapHost,
        defaults.imapPort,
        defaults.smtpHost,
        defaults.smtpPort,
        email,
        t,
        existing.id
      );
    } else {
      db.prepare(
        `INSERT INTO mailboxes(name, email, provider, auth_type, imap_host, imap_port, imap_secure,
          smtp_host, smtp_port, smtp_secure, username, access_token_enc, refresh_token_enc,
          token_expires_at, scope, created_at, updated_at)
         VALUES(?, ?, ?, 'oauth2', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        email,
        email,
        provider,
        defaults.imapHost,
        defaults.imapPort,
        defaults.smtpHost,
        defaults.smtpPort,
        defaults.smtpSecure,
        email,
        encryptText(tokens.accessToken),
        tokens.refreshToken ? encryptText(tokens.refreshToken) : null,
        tokens.expiresAt,
        tokens.scope,
        t,
        t
      );
    }
    res.redirect(`${frontend}/mailboxes?oauth=success&email=${encodeURIComponent(email)}`);
  } catch (err) {
    res.redirect(`${frontend}/mailboxes?oauth=error&msg=${encodeURIComponent(err.message)}`);
  }
});
