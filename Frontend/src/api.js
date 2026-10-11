import axios from 'axios';
import { beginRequest, endRequest } from './composables/useGlobalLoading.js';

export function errMsg(e) {
  return e?.response?.data?.error || e?.message || '请求失败';
}

const api = axios.create({ baseURL: '/api', timeout: 60000 });

export const shareApi = axios.create({ baseURL: '/api', timeout: 60000 });
shareApi.interceptors.response.use(
  (resp) => resp.data,
  (err) => Promise.reject(err)
);

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('mailflow_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // silent: true 的请求（后台轮询等）不触发全局加载提示
  if (config.silent !== true) {
    config.__glId = beginRequest(config.loadingLabel || '请求处理中…');
  }
  return config;
});

api.interceptors.response.use(
  (resp) => {
    endRequest(resp.config?.__glId);
    return resp.data;
  },
  (err) => {
    endRequest(err.config?.__glId);
    if (
      err?.response?.status === 401 &&
      !String(err.config?.url || '').startsWith('/auth/') &&
      !window.location.pathname.startsWith('/share')
    ) {
      localStorage.removeItem('mailflow_token');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export async function downloadToBlob(url, filename) {
  const resp = await api.get(url, { responseType: 'blob', loadingLabel: '正在下载附件…' });
  const blob = new Blob([resp]);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 轮询后台同步状态：POST /mailboxes/:id/sync 触发后立即返回，
 * 真正同步在服务器后台进行。此函数静默轮询直到目标邮箱同步完成或超时。
 * 返回 true 表示轮询到同步结束，false 表示超时（同步可能仍在继续）。
 */
export async function pollSyncDone(ids, { timeoutMs = 180000, intervalMs = 2500 } = {}) {
  const targets = (Array.isArray(ids) ? ids : [ids]).map(Number);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    try {
      const st = await api.get('/mailboxes/sync-status', { silent: true, timeout: 10000 });
      const cur = new Set((st.ids || []).map(Number));
      if (!targets.some((id) => cur.has(id))) return true;
    } catch {
      // 状态查询失败不打扰用户，下个周期重试
    }
  }
  return false;
}

export default api;
