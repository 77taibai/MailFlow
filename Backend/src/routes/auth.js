import { Router } from 'express';
import * as oidc from 'openid-client';
import crypto from 'node:crypto';
import { config, oidcEnabled } from '../config.js';
import { safeEqual, signSession, signToken, verifyToken } from '../crypto.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    const payload = verifyToken(token);
    if (payload.typ === 'share') return res.status(401).json({ error: '分享令牌不能用于登录' });
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期' });
  }
}

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 60000;
const LOGIN_MAX_ATTEMPTS = 10;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= LOGIN_MAX_ATTEMPTS;
}

let oidcConfigPromise = null;

async function getOidcConfig() {
  if (!oidcEnabled()) throw new Error('OIDC 未配置');
  if (!oidcConfigPromise) {
    const options = config.oidc.insecure ? { execute: [oidc.allowInsecureRequests] } : {};
    oidcConfigPromise = oidc
      .discovery(
        new URL(config.oidc.issuer),
        config.oidc.clientId,
        config.oidc.clientSecret,
        undefined,
        options
      )
      .catch((err) => {
        oidcConfigPromise = null;
        throw err;
      });
  }
  return oidcConfigPromise;
}

export const authRouter = Router();

authRouter.get('/config', (req, res) => {
  res.json({ oidcEnabled: oidcEnabled() });
});

authRouter.post('/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: '尝试过于频繁，请稍后再试' });
  }
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: '参数不完整' });
  }
  const ok = safeEqual(username, config.authUsername) && safeEqual(password, config.authPassword);
  if (!ok) return res.status(401).json({ error: '用户名或密码错误' });
  loginAttempts.delete(ip);
  res.json({ token: signSession(username, 'password'), username });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ username: req.user.sub, via: req.user.via });
});

authRouter.get('/oidc/login', async (req, res, next) => {
  try {
    const clientConfig = await getOidcConfig();
    const state = signToken({ t: 'oidc', n: crypto.randomBytes(16).toString('hex') }, 600);
    const redirectUri = `${config.appUrl}/api/auth/oidc/callback`;
    const redirectTo = oidc.buildAuthorizationUrl(clientConfig, {
      redirect_uri: redirectUri,
      scope: config.oidc.scopes,
      state,
    });
    res.redirect(redirectTo.href);
  } catch (err) {
    next(err);
  }
});

authRouter.get('/oidc/callback', async (req, res) => {
  const frontend = config.frontendOrigin || config.appUrl;
  try {
    const clientConfig = await getOidcConfig();
    const state = String(req.query.state || '');
    let statePayload;
    try {
      statePayload = verifyToken(state);
    } catch {
      return res.redirect(`${frontend}/login?error=state_invalid`);
    }
    if (!statePayload || statePayload.t !== 'oidc') {
      return res.redirect(`${frontend}/login?error=state_invalid`);
    }

    const currentUrl = new URL(req.originalUrl, config.appUrl);
    const tokens = await oidc.authorizationCodeGrant(clientConfig, currentUrl, {
      expectedState: state,
    });
    const claims = tokens.claims();
    const sub = claims.sub;
    if (!sub) {
      return res.redirect(`${frontend}/login?error=${encodeURIComponent('ID Token 缺少 sub claim')}`);
    }
    if (config.oidc.allowedSub && sub !== config.oidc.allowedSub) {
      return res.redirect(`${frontend}/login?error=${encodeURIComponent('该账号不被允许登录')}`);
    }
    const token = signSession(sub, 'oidc');
    res.redirect(`${frontend}/oidc-callback#token=${encodeURIComponent(token)}`);
  } catch (err) {
    res.redirect(`${frontend}/login?error=${encodeURIComponent(err.message || 'oidc_failed')}`);
  }
});
