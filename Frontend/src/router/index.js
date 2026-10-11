import { createRouter, createWebHistory } from 'vue-router';
import { ElMessage } from 'element-plus';
import { beginRequest, endRequest } from '../composables/useGlobalLoading.js';

const routes = [
  {
    path: '/login',
    component: () => import('../views/LoginView.vue'),
    meta: { public: true },
  },
  {
    path: '/oidc-callback',
    component: () => import('../views/OidcCallbackView.vue'),
    meta: { public: true },
  },
  {
    path: '/share/:token',
    component: () => import('../views/ShareView.vue'),
    meta: { public: true },
  },
  { path: '/', redirect: '/mail' },
  { path: '/mail/:id?', name: 'mail', component: () => import('../views/MailView.vue') },
  { path: '/compose', component: () => import('../views/ComposeView.vue') },
  { path: '/mailboxes', component: () => import('../views/MailboxesView.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/mail' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

let navLoadingId = null;

router.beforeEach((to) => {
  const token = localStorage.getItem('mailflow_token');
  if (!to.meta.public && !token) return '/login';
  if (to.path === '/login' && token) return '/';
  // 导航开始即挂到全局进度条上：懒加载页面 chunk 的下载耗时也能被用户感知
  if (navLoadingId === null) navLoadingId = beginRequest('页面加载中…');
});

router.afterEach(() => {
  endRequest(navLoadingId);
  navLoadingId = null;
});

router.onError((err) => {
  endRequest(navLoadingId);
  navLoadingId = null;
  const msg = String(err?.message || '');
  // 部署更新后旧页面引用的 chunk 已失效：提示并刷新一次
  if (
    /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch with/i.test(
      msg
    )
  ) {
    ElMessage.warning('页面资源已更新，正在重新加载…');
    window.location.reload();
  } else {
    ElMessage.error(msg || '页面加载失败');
  }
});

export default router;
