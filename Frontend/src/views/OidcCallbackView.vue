<template>
  <div class="callback-wrap">
    <el-icon class="icon" :size="32" color="#409eff"><Loading /></el-icon>
    <p>正在完成登录…</p>
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '../stores/auth.js';

const router = useRouter();
const auth = useAuthStore();

onMounted(async () => {
  const hash = window.location.hash || '';
  const match = hash.match(/token=([^&]+)/);
  if (!match) {
    ElMessage.error('登录回调缺少 token');
    router.replace('/login');
    return;
  }
  auth.setToken(decodeURIComponent(match[1]));
  await auth.fetchMe();
  router.replace('/');
});
</script>

<style scoped>
.callback-wrap {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-regular);
}
</style>
