import { db } from '../db.js';
import { decryptText, encryptText } from '../crypto.js';
import { refreshAccessToken } from './oauth.js';

const refreshing = new Map();

export function providerName(mailbox) {
  if (mailbox.provider === 'gmail' || mailbox.provider === 'outlook') return mailbox.provider;
  return null;
}

async function doRefresh(mailboxId, provider, refreshToken) {
  const result = await refreshAccessToken(provider, refreshToken);
  db.prepare(
    `UPDATE mailboxes
     SET access_token_enc = ?, refresh_token_enc = ?, token_expires_at = ?, scope = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    encryptText(result.accessToken),
    result.refreshToken ? encryptText(result.refreshToken) : null,
    result.expiresAt,
    result.scope,
    Date.now(),
    mailboxId
  );
  return result.accessToken;
}

export async function getCredentials(mailbox) {
  if (mailbox.auth_type === 'password') {
    const password = decryptText(mailbox.password_enc);
    if (!password) throw new Error('邮箱密码缺失，请重新编辑邮箱保存');
    return { user: mailbox.username || mailbox.email, pass: password };
  }

  const provider = providerName(mailbox);
  if (!provider) {
    throw new Error(`auth_type=oauth2 需要服务商标识（gmail/outlook），当前: ${mailbox.provider}`);
  }

  const cached = mailbox.access_token_enc ? decryptText(mailbox.access_token_enc) : null;
  const fresh = cached && mailbox.token_expires_at && mailbox.token_expires_at - Date.now() > 120000;
  if (fresh) {
    return { user: mailbox.username || mailbox.email, accessToken: cached };
  }

  const refreshToken = mailbox.refresh_token_enc ? decryptText(mailbox.refresh_token_enc) : null;
  if (!refreshToken) {
    throw new Error('缺少 refresh_token，请在邮箱管理页重新授权');
  }

  let pending = refreshing.get(mailbox.id);
  if (!pending) {
    pending = doRefresh(mailbox.id, provider, refreshToken).finally(() =>
      refreshing.delete(mailbox.id)
    );
    refreshing.set(mailbox.id, pending);
  }
  try {
    const accessToken = await pending;
    return { user: mailbox.username || mailbox.email, accessToken };
  } catch (err) {
    throw new Error(`OAuth token 刷新失败: ${err.message}（请重新授权该邮箱）`);
  }
}
