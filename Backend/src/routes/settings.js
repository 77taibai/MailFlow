import { Router } from 'express';
import { db, getSetting, setSetting } from '../db.js';
import { encryptText } from '../crypto.js';
import { getDingtalkConfig, sendMarkdown } from '../services/dingtalk.js';
import { globalSyncIntervalSec } from '../services/scheduler.js';

export const settingsRouter = Router();

settingsRouter.get('/', (req, res) => {
  const ding = getDingtalkConfig();
  res.json({
    dingtalk: {
      enabled: ding.enabled,
      webhook: ding.webhook,
      secretConfigured: Boolean(ding.secret),
    },
    globalSyncIntervalSec: globalSyncIntervalSec(),
  });
});

settingsRouter.put('/', (req, res) => {
  const body = req.body || {};
  const ding = body.dingtalk || {};

  if (ding.enabled !== undefined) {
    setSetting('dingtalk_enabled', ding.enabled ? '1' : '0');
  }
  if (ding.webhook !== undefined) {
    setSetting('dingtalk_webhook', String(ding.webhook).trim());
  }
  if (ding.secret !== undefined && ding.secret !== '') {
    setSetting('dingtalk_secret_enc', encryptText(String(ding.secret)));
  }
  if (body.globalSyncIntervalSec !== undefined) {
    const n = Number(body.globalSyncIntervalSec);
    setSetting('global_sync_interval_sec', Number.isFinite(n) && n >= 30 ? String(n) : null);
  }
  res.json({ ok: true });
});

settingsRouter.post('/dingtalk/test', async (req, res) => {
  try {
    await sendMarkdown(
      'MailFlow 测试消息',
      '### MailFlow\n\n这是一条测试消息，如果你看到了它，说明钉钉推送配置正确。'
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
