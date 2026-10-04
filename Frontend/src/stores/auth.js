import { defineStore } from 'pinia';
import api from '../api.js';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('mailflow_token') || '',
  }),
  getters: {
    isLoggedIn: (state) => Boolean(state.token),
  },
  actions: {
    setToken(token) {
      this.token = token;
      localStorage.setItem('mailflow_token', token);
    },
    async fetchMe() {
      try {
        await api.get('/auth/me');
      } catch {
        this.logout();
      }
    },
    logout() {
      this.token = '';
      localStorage.removeItem('mailflow_token');
    },
  },
});
