import { listMailboxes, getSetting } from '../db.js';
import { config } from '../config.js';
import { syncMailbox } from './imap.js';

const syncing = new Set();
let chain = Promise.resolve();

export function globalSyncIntervalSec() {
  const v = getSetting('global_sync_interval_sec');
  if (v !== null && v !== '') {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 30) return n;
  }
  return config.syncIntervalSec;
}

export function syncOne(mailboxId) {
  if (syncing.has(mailboxId)) return false;
  syncing.add(mailboxId);
  chain = chain
    .then(async () => {
      try {
        await syncMailbox(mailboxId);
        return true;
      } catch (err) {
        console.error(`[sync] 邮箱 ${mailboxId} 同步失败:`, err.message);
        return false;
      }
    })
    .finally(() => syncing.delete(mailboxId));
  return true;
}

function tick() {
  const interval = globalSyncIntervalSec();
  const mailboxes = listMailboxes();
  for (const mb of mailboxes) {
    const per = mb.sync_interval_sec && mb.sync_interval_sec >= 30 ? mb.sync_interval_sec : interval;
    const last = mb.last_sync_at || 0;
    if (Date.now() - last >= per * 1000) {
      syncOne(mb.id);
    }
  }
}

export function initScheduler() {
  setInterval(() => {
    try {
      tick();
    } catch (err) {
      console.error('[scheduler] tick 异常:', err.message);
    }
  }, 30000);
  if (config.syncOnStart) {
    setTimeout(() => {
      try {
        tick();
      } catch (err) {
        console.error('[scheduler] 启动同步异常:', err.message);
      }
    }, 30000);
  }
  console.log('[scheduler] 已启动');
}
