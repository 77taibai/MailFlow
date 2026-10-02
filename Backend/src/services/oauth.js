import { config } from '../config.js';

export const PROVIDERS = {
  gmail: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://mail.google.com/ https://www.googleapis.com/auth/userinfo.email',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: 1,
    userinfo: async (accessToken) => {
      const data = await apiGet('https://www.googleapis.com/oauth2/v3/userinfo', accessToken);
      return data.email;
    },
  },
  outlook: {
    authUrl: (tenant) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: (tenant) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    scope:
      'openid email offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send',
    extraAuthParams: { response_mode: 'query' },
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: 0,
  },
};

function providerConfig(name) {
  const p = PROVIDERS[name];
  if (!p) throw new Error(`不支持的 OAuth 服务商: ${name}`);
  if (name === 'gmail') {
    if (!config.google.clientId || !config.google.clientSecret) {
      throw new Error('Gmail OAuth 未配置：请在 .env 设置 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET');
    }
    return { ...p, clientId: config.google.clientId, clientSecret: config.google.clientSecret };
  }
  if (!config.microsoft.clientId || !config.microsoft.clientSecret) {
    throw new Error(
      'Microsoft OAuth 未配置：请在 .env 设置 MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET'
    );
  }
  return { ...p, clientId: config.microsoft.clientId, clientSecret: config.microsoft.clientSecret };
}

export function buildAuthRedirect(name, redirectUri, state) {
  const p = providerConfig(name);
  const url = new URL(typeof p.authUrl === 'function' ? p.authUrl(config.microsoft.tenant) : p.authUrl);
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', p.scope);
  url.searchParams.set('state', state);
  for (const [k, v] of Object.entries(p.extraAuthParams || {})) {
    url.searchParams.set(k, v);
  }
  return url;
}

async function tokenRequest(name, params) {
  const p = providerConfig(name);
  const body = new URLSearchParams({
    client_id: p.clientId,
    client_secret: p.clientSecret,
    ...params,
  });
  const url = typeof p.tokenUrl === 'function' ? p.tokenUrl(config.microsoft.tenant) : p.tokenUrl;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`OAuth token 请求失败: ${data.error_description || data.error || resp.status}`);
  }
  return data;
}

export async function exchangeCode(name, code, redirectUri) {
  const p = providerConfig(name);
  const data = await tokenRequest(name, {
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: p.scope,
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    scope: data.scope || '',
    claims: decodeIdToken(data.id_token),
  };
}

export async function refreshAccessToken(name, refreshToken) {
  const p = providerConfig(name);
  const params = {
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    client_id: p.clientId,
    client_secret: p.clientSecret,
  };
  if (name === 'outlook') params.scope = p.scope;
  const data = await tokenRequest(name, params);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    scope: data.scope || '',
  };
}

export function decodeIdToken(idToken) {
  if (!idToken) return {};
  try {
    const payload = String(idToken).split('.')[1];
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

export function claimsToEmail(claims) {
  if (!claims) return null;
  return claims.email || claims.preferred_username || claims.upn || null;
}

export async function getUserEmail(name, accessToken) {
  const p = providerConfig(name);
  if (!p.userinfo) return null;
  const email = await p.userinfo(accessToken);
  if (!email) throw new Error('无法从服务商获取邮箱地址');
  return email;
}

async function apiGet(url, accessToken) {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`userinfo 请求失败: ${data.error?.message || resp.status}`);
  return data;
}
