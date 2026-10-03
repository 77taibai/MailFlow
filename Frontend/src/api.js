import axios from 'axios';

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
  return config;
});

api.interceptors.response.use(
  (resp) => resp.data,
  (err) => {
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
  const resp = await api.get(url, { responseType: 'blob' });
  const blob = new Blob([resp]);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export default api;
