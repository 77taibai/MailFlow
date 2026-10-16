<template>
  <div class="page">
    <div class="page-header" v-if="!(isMobile && selectedMailbox)">
      <h2>邮箱管理</h2>
      <div class="header-actions">
        <el-tooltip
          :disabled="oauth.gmail"
          content="需在 .env 配置 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 后启用"
        >
          <span>
            <el-button type="success" :disabled="!oauth.gmail" :loading="oauthStarting === 'gmail'" @click="oauthStart('gmail')">
              <el-icon><Link /></el-icon>&nbsp;Gmail 授权
            </el-button>
          </span>
        </el-tooltip>
        <el-tooltip
          :disabled="oauth.outlook"
          content="需在 .env 配置 MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET 后启用"
        >
          <span>
            <el-button type="success" :disabled="!oauth.outlook" :loading="oauthStarting === 'outlook'" @click="oauthStart('outlook')">
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

    <el-table v-if="!isMobile" :data="mailboxes" v-loading="loading">
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
            <el-button size="small" :loading="row._testing" :disabled="row._syncing || row._deleting" @click="testMailbox(row)">测试</el-button>
            <el-button size="small" :loading="row._syncing" :disabled="row._testing || row._deleting" @click="syncMailbox(row)">同步</el-button>
            <el-button size="small" type="primary" :disabled="row._testing || row._syncing || row._deleting" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" :loading="row._deleting" :disabled="row._testing || row._syncing" @click="removeMailbox(row)">删除</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div v-else class="mobile-mailboxes" v-loading="loading">
      <template v-if="!selectedMailbox">
        <el-empty v-if="!mailboxes.length" description="暂无邮箱" />
        <div v-else class="mailbox-list">
          <div
            v-for="row in mailboxes"
            :key="row.id"
            class="mailbox-row"
            @click="selectedMailbox = row"
          >
            <div class="mailbox-row-main">
              <div class="mailbox-name">{{ row.name }}</div>
              <div class="mailbox-email">{{ row.email }}</div>
            </div>
            <el-tag size="small" :type="row.status === 'ok' ? 'success' : 'danger'">
              {{ row.status === 'ok' ? '正常' : '错误' }}
            </el-tag>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="detail-header">
          <el-button :icon="ArrowLeft" circle @click="selectedMailbox = null" />
          <span class="detail-title">{{ selectedMailbox.name }}</span>
        </div>
        <dl class="detail-list">
          <div class="detail-item">
            <dt>地址</dt>
            <dd>{{ selectedMailbox.email }}</dd>
          </div>
          <div class="detail-item">
            <dt>服务商</dt>
            <dd>{{ providerLabel(selectedMailbox.provider) }}</dd>
          </div>
          <div class="detail-item">
            <dt>认证</dt>
            <dd>{{ selectedMailbox.authType === 'oauth2' ? 'OAuth2' : '密码' }}</dd>
          </div>
          <div class="detail-item">
            <dt>状态</dt>
            <dd>
              <el-tooltip :content="selectedMailbox.lastError || ''" :disabled="!selectedMailbox.lastError">
                <el-tag size="small" :type="selectedMailbox.status === 'ok' ? 'success' : 'danger'">
                  {{ selectedMailbox.status === 'ok' ? '正常' : '错误' }}
                </el-tag>
              </el-tooltip>
            </dd>
          </div>
          <div class="detail-item">
            <dt>未读/总数</dt>
            <dd>{{ selectedMailbox.unreadCount }} / {{ selectedMailbox.totalCount }}</dd>
          </div>
          <div class="detail-item">
            <dt>最近同步</dt>
            <dd>{{ formatDateTime(selectedMailbox.lastSyncAt) || '从未' }}</dd>
          </div>
          <div class="detail-item">
            <dt>同步间隔</dt>
            <dd>{{ selectedMailbox.syncIntervalSec ? selectedMailbox.syncIntervalSec + ' 秒' : '全局设置' }}</dd>
          </div>
          <div class="detail-item">
            <dt>钉钉推送</dt>
            <dd>
              <el-tag size="small" :type="selectedMailbox.dingtalkEnabled ? 'success' : 'info'">
                {{ selectedMailbox.dingtalkEnabled ? '启用' : '关闭' }}
              </el-tag>
            </dd>
          </div>
          <div class="detail-item">
            <dt>推送关键词</dt>
            <dd>
              <template v-if="selectedMailbox.dingtalkInclude || selectedMailbox.dingtalkExclude">
                <div v-if="selectedMailbox.dingtalkInclude">包含: {{ selectedMailbox.dingtalkInclude }}</div>
                <div v-if="selectedMailbox.dingtalkExclude">排除: {{ selectedMailbox.dingtalkExclude }}</div>
              </template>
              <span v-else>-</span>
            </dd>
          </div>
        </dl>
        <div class="detail-actions">
          <el-button :loading="selectedMailbox._testing" :disabled="selectedMailbox._syncing || selectedMailbox._deleting" @click="testMailbox(selectedMailbox)">测试</el-button>
          <el-button :loading="selectedMailbox._syncing" :disabled="selectedMailbox._testing || selectedMailbox._deleting" @click="syncMailbox(selectedMailbox)">同步</el-button>
          <el-button type="primary" :disabled="selectedMailbox._testing || selectedMailbox._syncing || selectedMailbox._deleting" @click="openEdit(selectedMailbox)">编辑</el-button>
          <el-button type="danger" :loading="selectedMailbox._deleting" :disabled="selectedMailbox._testing || selectedMailbox._syncing" @click="removeMailbox(selectedMailbox)">删除</el-button>
        </div>
      </template>
    </div>

    <mailbox-form-dialog ref="formRef" @saved="load" />
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Link, ArrowLeft } from '@element-plus/icons-vue';
import api, { errMsg, pollSyncDone } from '../api.js';
import { formatDateTime } from '../utils.js';
import { useIsMobile } from '../composables/useIsMobile.js';
import MailboxFormDialog from '../components/MailboxFormDialog.vue';

const route = useRoute();
const mailboxes = ref([]);
const oauth = reactive({ gmail: false, outlook: false });
const oauthStarting = ref('');
const loading = ref(false);
const formRef = ref();
const isMobile = useIsMobile();
const selectedMailbox = ref(null);

function providerLabel(p) {
  if (p === 'gmail') return 'Gmail';
  if (p === 'outlook') return 'Outlook';
  return '自定义';
}

async function load() {
  loading.value = true;
  try {
    const data = await api.get('/mailboxes', { loadingLabel: '正在加载邮箱列表…' });
    mailboxes.value = data.items.map((m) => ({
      ...m,
      _syncing: false,
      _testing: false,
      _deleting: false,
    }));
    if (selectedMailbox.value) {
      selectedMailbox.value =
        mailboxes.value.find((m) => m.id === selectedMailbox.value.id) || null;
    }
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

async function oauthStart(provider) {
  oauthStarting.value = provider;
  try {
    const data = await api.get(`/mailboxes/oauth/${provider}/start`, {
      loadingLabel: '正在发起 OAuth 授权…',
    });
    window.location.href = data.url;
  } catch (e) {
    ElMessage.error(errMsg(e));
    oauthStarting.value = '';
  }
}

async function testMailbox(row) {
  if (row._testing || row._syncing || row._deleting) return;
  row._testing = true;
  try {
    // IMAP + SMTP 串行连接，慢服务商下可能长达一分钟，放宽超时并给出明确提示
    const data = await api.post(`/mailboxes/${row.id}/test`, null, {
      timeout: 180000,
      loadingLabel: `正在测试「${row.name}」的连接，最长约需 1 分钟…`,
    });
    if (data.imap.ok && data.smtp.ok) ElMessage.success('IMAP / SMTP 连接正常');
    else {
      if (!data.imap.ok) ElMessage.error(`IMAP 失败: ${data.imap.error}`);
      if (!data.smtp.ok) ElMessage.error(`SMTP 失败: ${data.smtp.error}`);
    }
    load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    row._testing = false;
  }
}

async function syncMailbox(row) {
  if (row._syncing) return;
  row._syncing = true;
  try {
    await api.post(`/mailboxes/${row.id}/sync`, null, { loadingLabel: '正在触发同步…' });
    ElMessage.info('同步任务已启动，正在从服务器拉取邮件…');
    const done = await pollSyncDone([row.id]);
    await load();
    if (done) ElMessage.success(`「${row.name}」同步完成`);
    else ElMessage.warning('同步仍在进行中，稍后可刷新查看');
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    row._syncing = false;
  }
}

async function removeMailbox(row) {
  if (row._deleting || row._syncing || row._testing) return;
  try {
    await ElMessageBox.confirm(
      `确定删除邮箱「${row.name}」吗？其所有本地邮件与附件都会被删除。`,
      '删除邮箱',
      { type: 'warning' }
    );
  } catch {
    return;
  }
  row._deleting = true;
  try {
    await api.delete(`/mailboxes/${row.id}`, { loadingLabel: '正在删除邮箱及其邮件…' });
    ElMessage.success('已删除');
    if (selectedMailbox.value && selectedMailbox.value.id === row.id) selectedMailbox.value = null;
    load();
  } catch (e) {
    ElMessage.error(errMsg(e));
    row._deleting = false;
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
.mailbox-list {
  border-top: 1px solid var(--el-border-color-lighter);
}
.mailbox-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 56px;
  padding: 8px 4px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  cursor: pointer;
}
.mailbox-row:active {
  background: var(--el-fill-color-light);
}
.mailbox-row-main {
  min-width: 0;
}
.mailbox-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mailbox-email {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.detail-title {
  font-weight: 600;
  font-size: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-list {
  margin: 0;
}
.detail-item {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.detail-item dt {
  flex: none;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.detail-item dd {
  margin: 0;
  min-width: 0;
  text-align: right;
  word-break: break-word;
}
.detail-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 16px;
}
.detail-actions .el-button {
  width: 100%;
  margin-left: 0;
}
@media (max-width: 767.98px) {
  .page-header {
    flex-wrap: wrap;
    gap: 8px;
  }
  .header-actions {
    flex-wrap: wrap;
  }
}
</style>
