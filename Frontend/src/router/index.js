import { createRouter, createWebHistory } from 'vue-router';

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
  { path: '/', component: () => import('../views/MailView.vue') },
  { path: '/mailboxes', component: () => import('../views/MailboxesView.vue') },
  { path: '/settings', component: () => import('../views/SettingsView.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const token = localStorage.getItem('mailflow_token');
  if (!to.meta.public && !token) return '/login';
  if (to.path === '/login' && token) return '/';
});

export default router;
