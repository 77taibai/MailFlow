<template>
  <div class="page">
    <div class="page-header">
      <h2>设置</h2>
      <router-link to="/"><el-button>返回邮件</el-button></router-link>
    </div>

    <el-card>
      <template #header>
        <div class="card-title">
          <span>钉钉机器人推送</span>
          <el-switch v-model="dingtalk.enabled" active-text="启用" />
        </div>
      </template>
      <el-form label-width="120px" style="max-width: 640px">
        <el-form-item label="Webhook 地址">
          <el-input v-model="dingtalk.webhook" placeholder="https://oapi.dingtalk.com/robot/send?access_token=..." />
        </el-form-item>
        <el-form-item label="加签密钥">
          <el-input
            v-model="dingtalk.secret"
            type="password"
            show-password
            :placeholder="secretConfigured ? '已配置，留空保持不变' : 'SEC 开头的加签密钥，可留空'"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
          <el-button :loading="testing" @click="test">发送测试消息</el-button>
        </el-form-item>
        <el-form-item>
          <div class="tip">
            提示：机器人安全设置建议选择“加签”。每个邮箱可在“邮箱管理 → 编辑”中单独开关推送并配置关键词过滤。
          </div>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card style="margin-top: 16px">
      <template #header><span>同步</span></template>
      <el-form label-width="120px" style="max-width: 640px">
        <el-form-item label="全局间隔(秒)">
          <el-input-number v-model="globalInterval" :min="30" :step="30" controls-position="right" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
          <div class="tip" style="margin-left: 10px">单个邮箱可在“邮箱管理 → 编辑”中覆盖该间隔。</div>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import api, { errMsg } from '../api.js';

const dingtalk = reactive({ enabled: false, webhook: '', secret: '' });
const secretConfigured = ref(false);
const globalInterval = ref(300);
const saving = ref(false);
const testing = ref(false);

async function load() {
  try {
    const data = await api.get('/settings');
    dingtalk.enabled = data.dingtalk.enabled;
    dingtalk.webhook = data.dingtalk.webhook;
    secretConfigured.value = data.dingtalk.secretConfigured;
    globalInterval.value = data.globalSyncIntervalSec;
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function save() {
  saving.value = true;
  try {
    await api.put('/settings', {
      dingtalk: {
        enabled: dingtalk.enabled,
        webhook: dingtalk.webhook,
        secret: dingtalk.secret || undefined,
      },
      globalSyncIntervalSec: globalInterval.value,
    });
    ElMessage.success('已保存');
    dingtalk.secret = '';
    load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    saving.value = false;
  }
}

async function test() {
  testing.value = true;
  try {
    await api.post('/settings/dingtalk/test');
    ElMessage.success('测试消息已发送，请在钉钉群查看');
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    testing.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.page {
  padding: 20px;
  max-width: 900px;
  margin: 0 auto;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.page-header h2 {
  margin: 0;
}
.card-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.tip {
  font-size: 12px;
  color: #909399;
}
</style>
