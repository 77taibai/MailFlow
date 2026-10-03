<template>
  <div class="page">
    <div class="page-header">
      <h2>邮箱管理</h2>
      <div class="header-actions">
        <el-tooltip
          :disabled="oauth.gmail"
          content="需在 .env 配置 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 后启用"
        >
          <span>
            <el-button type="success" :disabled="!oauth.gmail" @click="oauthStart('gmail')">
              <el-icon><Link /></el-icon>&nbsp;Gmail 授权
            </el-button>
          </span>
        </el-tooltip>
        <el-tooltip
          :disabled="oauth.outlook"
          content="需在 .env 配置 MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET 后启用"
        >
          <span>
            <el-button type="success" :disabled="!oauth.outlook" @click="oauthStart('outlook')">
              <el-icon><Link /></el-icon>&nbsp;Outlook 授权
            </el-button>
          </span>
        </el-tooltip>
        <el-button type="primary" :icon="Plus" @click="openCreate">添加自定义邮箱</el-button>
        <router-link to="/"><el-button>返回邮件</el-button></router-link>
      </div>
    </div>

    <el-alert
      v-if="route.query.oauth === 'success'"
      :title="`邮箱 ${route.query.email || ''} 授权成功`"
      type="success"
      show-icon
      style="margin-bottom: 12px"
    />
    <el-alert
      v-if="route.query.oauth === 'error'"
      :title="`授权失败: ${route.query.msg || '未知错误'}`"
      type="error"
      show-icon
      style="margin-bottom: 12px"
    />

    <el-table :data="mailboxes" v-loading="loading">
      <el-table-column prop="name" label="名称" min-width="140" />
      <el-table-column prop="email" label="地址" min-width="200" />
      <el-table-column label="服务商" width="100">
        <template #default="{ row }">
          <el-tag size="small">{{ providerLabel(row.provider) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="认证" width="90">
        <template #default="{ row }">
          <el-tag size="small" :type="row.authType === 'oauth2' ? 'warning' : 'info'">
            {{ row.authType === 'oauth2' ? 'OAuth2' : '密码' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tooltip :content="row.lastError || ''" :disabled="!row.lastError">
            <el-tag size="small" :type="row.status === 'ok' ? 'success' : 'danger'">
              {{ row.status === 'ok' ? '正常' : '错误' }}
            </el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="未读/总数" width="100">
        <template #default="{ row }">{{ row.unreadCount }} / {{ row.totalCount }}</template>
      </el-table-column>
      <el-table-column label="最近同步" width="160">
        <template #default="{ row }">{{ formatDateTime(row.lastSyncAt) || '从未' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="300" fixed="right">
        <template #default="{ row }">
          <div class="row-actions">
            <el-button size="small" @click="testMailbox(row)">测试</el-button>
            <el-button size="small" :loading="row._syncing" @click="syncMailbox(row)">同步</el-button>
            <el-button size="small" @click="openFolders(row)">文件夹</el-button>
            <el-button size="small" type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="removeMailbox(row)">删除</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <mailbox-form-dialog ref="formRef" @saved="load" />
    <folders-dialog ref="foldersRef" @saved="load" />
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Link } from '@element-plus/icons-vue';
import api, { errMsg } from '../api.js';
import { formatDateTime } from '../utils.js';
import MailboxFormDialog from '../components/MailboxFormDialog.vue';
import FoldersDialog from '../components/FoldersDialog.vue';

const route = useRoute();
const mailboxes = ref([]);
const oauth = reactive({ gmail: false, outlook: false });
const loading = ref(false);
const formRef = ref();
const foldersRef = ref();

function providerLabel(p) {
  if (p === 'gmail') return 'Gmail';
  if (p === 'outlook') return 'Outlook';
  return '自定义';
}

async function load() {
  loading.value = true;
  try {
    const data = await api.get('/mailboxes');
    mailboxes.value = data.items.map((m) => ({ ...m, _syncing: false }));
    oauth.gmail = Boolean(data.oauth?.gmail);
    oauth.outlook = Boolean(data.oauth?.outlook);
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  formRef.value.open(null);
}

function openEdit(row) {
  formRef.value.open(row);
}

function openFolders(row) {
  foldersRef.value.open(row);
}

async function oauthStart(provider) {
  try {
    const data = await api.get(`/mailboxes/oauth/${provider}/start`);
    window.location.href = data.url;
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function testMailbox(row) {
  loading.value = true;
  try {
    const data = await api.post(`/mailboxes/${row.id}/test`);
    if (data.imap.ok && data.smtp.ok) ElMessage.success('IMAP / SMTP 连接正常');
    else {
      if (!data.imap.ok) ElMessage.error(`IMAP 失败: ${data.imap.error}`);
      if (!data.smtp.ok) ElMessage.error(`SMTP 失败: ${data.smtp.error}`);
    }
    load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    loading.value = false;
  }
}

async function syncMailbox(row) {
  row._syncing = true;
  try {
    await api.post(`/mailboxes/${row.id}/sync`);
    ElMessage.success('同步已触发');
    setTimeout(load, 3000);
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    row._syncing = false;
  }
}

async function removeMailbox(row) {
  try {
    await ElMessageBox.confirm(
      `确定删除邮箱「${row.name}」吗？其所有本地邮件与附件都会被删除。`,
      '删除邮箱',
      { type: 'warning' }
    );
  } catch {
    return;
  }
  try {
    await api.delete(`/mailboxes/${row.id}`);
    ElMessage.success('已删除');
    load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

onMounted(load);
</script>

<style scoped>
.page {
  padding: 20px;
  max-width: 1200px;
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
.header-actions {
  display: flex;
  gap: 8px;
}
.row-actions {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
}
.row-actions .el-button {
  flex: none;
  margin-left: 0;
  padding: 5px 9px;
}
</style>
