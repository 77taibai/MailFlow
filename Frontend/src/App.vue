<template>
  <router-view />
  <global-loading-bar />
</template>

<script setup>
import GlobalLoadingBar from './components/GlobalLoadingBar.vue';
import { useTheme } from './composables/useTheme.js';

// 无侧栏的页面（登录、分享、OIDC 回调）也在这里挂载一次主题副作用，保证实时跟随系统
useTheme();
</script>

<style>
:root {
  --mf-brand-text: #2b4c6f;
  --mf-login-bg: linear-gradient(135deg, #1f2d3d 0%, #2b4c6f 100%);
}

html.dark {
  --mf-brand-text: #c8d6ea;
  --mf-login-bg: linear-gradient(135deg, #0d1117 0%, #16202e 100%);
}

/* Element Plus 默认按钮（无 type）在深色下的背景取 --el-fill-color-blank，
   与页面底色 --el-bg-color 同为 #141414，导致按钮只剩细边框、没有层次；
   这里为默认按钮提亮一档，恢复可辨识的浮起感。
   仅排除带 type 的变体与 text/link，保留 --small/--large 等尺寸修饰符 */
html.dark .el-button:not(.el-button--primary):not(.el-button--success):not(.el-button--warning):not(.el-button--danger):not(.el-button--info):not(.el-button--text):not(.is-text):not(.is-link) {
  --el-button-bg-color: var(--el-fill-color-light);
  --el-button-border-color: var(--el-border-color);
  --el-button-hover-bg-color: var(--el-fill-color);
  --el-button-hover-border-color: var(--el-border-color-dark);
  --el-button-active-bg-color: var(--el-fill-color-dark);
  --el-button-active-border-color: var(--el-border-color-darker);
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body,
#app {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow-x: hidden;
  font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
}
</style>
