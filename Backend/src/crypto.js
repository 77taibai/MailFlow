import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

const encKey = crypto.scryptSync(config.appSecret, 'mailflow-enc-v1', 32);

export function encryptText(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export function decryptText(stored) {
  if (!stored) return null;
  const [ivB64, tagB64, dataB64] = String(stored).split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('加密数据格式无效');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest();
}

export function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

export function signToken(payload, ttlSeconds) {
  return jwt.sign(payload, config.appSecret, { expiresIn: ttlSeconds });
}

export function verifyToken(token) {
  return jwt.verify(token, config.appSecret);
}

export function signSession(username, via) {
  return signToken({ sub: username, via }, config.jwtTtlHours * 3600);
}
