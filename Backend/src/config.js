import 'dotenv/config';
import path from 'node:path';

const env = process.env;

const num = (name, def) => {
  const v = env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const bool = (name, def) => {
  const v = env[name];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

const port = num('PORT', 3000);

const appSecret = env.APP_SECRET || '';
if (!appSecret) {
  throw new Error('缺少 APP_SECRET 环境变量，请在 .env 中设置（用于 JWT 签名与敏感数据加密）');
}

const authPassword = env.AUTH_PASSWORD || '';
if (!authPassword) {
  throw new Error('缺少 AUTH_PASSWORD 环境变量，请在 .env 中设置（单用户密码登录）');
}

export const config = {
  port,
  host: env.HOST || '',
  appUrl: (env.APP_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  frontendOrigin: (env.FRONTEND_ORIGIN || '').replace(/\/+$/, ''),
  appSecret,
  dataDir: path.resolve(env.DATA_DIR || './data'),
  authPassword,
  jwtTtlHours: num('JWT_TTL_HOURS', 168),
  shareSecret: env.SHARE_SECRET || '',
  shareTtlHours: num('SHARE_TTL_HOURS', 168),
  syncIntervalSec: num('SYNC_INTERVAL_SEC', 300),
  syncBackfillCount: num('SYNC_BACKFILL_COUNT', 50),
  syncOnStart: bool('SYNC_ON_START', true),
  pushMaxAgeHours: num('PUSH_MAX_AGE_HOURS', 48),
  dingtalkWebhook: env.DINGTALK_WEBHOOK_URL || '',
  dingtalkSecret: env.DINGTALK_SECRET || '',
  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
  },
  microsoft: {
    clientId: env.MICROSOFT_CLIENT_ID || '',
    clientSecret: env.MICROSOFT_CLIENT_SECRET || '',
    tenant: env.MICROSOFT_TENANT || 'common',
  },
  oidc: {
    issuer: env.OIDC_ISSUER || '',
    clientId: env.OIDC_CLIENT_ID || '',
    clientSecret: env.OIDC_CLIENT_SECRET || '',
    scopes: env.OIDC_SCOPES || 'openid',
    allowedSub: env.OIDC_ALLOWED_SUB || '',
    insecure: bool('OIDC_INSECURE', false),
  },
};

export function oidcEnabled() {
  return Boolean(config.oidc.issuer && config.oidc.clientId && config.oidc.clientSecret);
}

export function oauthProviderEnabled(name) {
  if (name === 'gmail') return Boolean(config.google.clientId && config.google.clientSecret);
  if (name === 'outlook') return Boolean(config.microsoft.clientId && config.microsoft.clientSecret);
  return false;
}
