import { computed, ref, watchEffect } from 'vue';

const STORAGE_KEY = 'mailflow_theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const MODES = ['system', 'light', 'dark'];

const media = window.matchMedia(DARK_QUERY);
const systemDark = ref(media.matches);

function readStoredMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

const mode = ref(readStoredMode());

const resolved = computed(() => {
  if (mode.value === 'system') return systemDark.value ? 'dark' : 'light';
  return mode.value;
});

function setMode(next) {
  mode.value = MODES.includes(next) ? next : 'system';
  try {
    localStorage.setItem(STORAGE_KEY, mode.value);
  } catch {
    /* 隐私模式等场景下写入失败不影响本次切换 */
  }
}

const themeIcon = computed(() => ({ system: 'Monitor', light: 'Sunny', dark: 'Moon' })[mode.value]);
const themeLabel = computed(() => ({ system: '跟随系统', light: '浅色', dark: '深色' })[mode.value]);

media.addEventListener('change', (e) => {
  systemDark.value = e.matches;
});

// 单例副作用：模块加载时挂一次，mode/系统偏好任一变化都会重算并同步 <html>
watchEffect(() => {
  document.documentElement.classList.toggle('dark', resolved.value === 'dark');
});

export function useTheme() {
  return { mode, resolved, setMode, themeIcon, themeLabel };
}
