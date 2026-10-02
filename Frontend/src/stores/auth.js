import { defineStore } from 'pinia';
import api from '../api.js';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('mailflow_token') || '',
    username: '',
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
        const data = await api.get('/auth/me');
        this.username = data.username;
      } catch {
        this.logout();
      }
    },
    logout() {
      this.token = '';
      this.username = '';
      localStorage.removeItem('mailflow_token');
    },
  },
});
