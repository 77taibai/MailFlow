<template>
  <div class="login-wrap">
    <el-card class="login-card">
      <h2 class="title">MailFlow</h2>
      <p class="subtitle">电子邮件同步中心</p>
      <el-form @submit.prevent="doLogin">
        <el-form-item>
          <el-input v-model="password" type="password" placeholder="密码" size="large" show-password>
            <template #prefix><el-icon><Lock /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-button type="primary" size="large" style="width: 100%" :loading="loading" native-type="submit">
          登录
        </el-button>
        <el-button
          v-if="oidcEnabled"
          size="large"
          style="width: 100%; margin-top: 10px; margin-left: 0"
          @click="oidcLogin"
        >
          使用 OIDC 登录
        </el-button>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api, { errMsg } from '../api.js';
import { useAuthStore } from '../stores/auth.js';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const password = ref('');
const loading = ref(false);
const oidcEnabled = ref(false);

onMounted(async () => {
  if (route.query.error) {
    ElMessage.error(`登录失败: ${route.query.error}`);
  }
  try {
    const data = await api.get('/auth/config');
    oidcEnabled.value = Boolean(data.oidcEnabled);
  } catch {
    oidcEnabled.value = false;
  }
});

async function doLogin() {
  if (!password.value) {
    ElMessage.warning('请输入密码');
    return;
  }
  loading.value = true;
  try {
    const data = await api.post('/auth/login', { password: password.value });
    auth.setToken(data.token);
    router.replace('/');
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    loading.value = false;
  }
}

function oidcLogin() {
  window.location.href = '/api/auth/oidc/login';
}
</script>

<style scoped>
.login-wrap {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1f2d3d 0%, #2b4c6f 100%);
}
.login-card {
  width: min(380px, calc(100vw - 32px));
  padding: 10px 15px;
}
.title {
  text-align: center;
  margin: 10px 0 0;
  color: #2b4c6f;
}
.subtitle {
  text-align: center;
  color: #909399;
  margin: 6px 0 20px;
  font-size: 13px;
}
</style>
