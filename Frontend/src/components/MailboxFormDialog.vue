<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="640px"
    :fullscreen="isMobile"
    :close-on-click-modal="false"
  >
    <div class="dialog-scroll">
    <el-alert
      v-if="isOauth"
      type="info"
      :closable="false"
      style="margin-bottom: 14px"
      title="该邮箱通过 OAuth 授权接入，服务器与凭据由系统自动管理；如需更换账号，请删除后重新授权。"
    />

    <el-form :label-position="isMobile ? 'top' : 'right'" :label-width="isMobile ? 'auto' : '110px'">
      <el-form-item label="名称" required>
        <el-input v-model="form.name" placeholder="显示名称" />
      </el-form-item>
      <el-form-item label="发件人名称">
        <el-input v-model="form.senderName" placeholder="发件时显示的名字，留空则只显示邮箱地址" />
      </el-form-item>

      <template v-if="!isOauth">
        <el-form-item label="邮箱地址" required>
          <el-input v-model="form.email" placeholder="user@example.com" />
        </el-form-item>
        <el-form-item label="登录账号" required>
          <el-input v-model="form.username" placeholder="IMAP/SMTP 登录用户名，一般是邮箱地址" />
        </el-form-item>
        <el-form-item label="密码/授权码">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            :placeholder="editing ? '留空表示不修改' : '密码或服务商授权码'"
          />
        </el-form-item>

        <el-divider content-position="left">IMAP（收件）</el-divider>
        <el-form-item label="IMAP 服务器" required>
          <div class="host-row">
            <el-input v-model="form.imapHost" placeholder="imap.example.com" />
            <el-input-number v-model="form.imapPort" :min="1" :max="65535" controls-position="right" />
            <el-checkbox v-model="form.imapSecure">SSL</el-checkbox>
          </div>
        </el-form-item>

        <el-divider content-position="left">SMTP（发件）</el-divider>
        <el-form-item label="SMTP 服务器" required>
          <div class="host-row">
            <el-input v-model="form.smtpHost" placeholder="smtp.example.com" />
            <el-input-number v-model="form.smtpPort" :min="1" :max="65535" controls-position="right" />
            <el-checkbox v-model="form.smtpSecure">SSL</el-checkbox>
          </div>
        </el-form-item>
      </template>

      <el-divider content-position="left">同步与推送</el-divider>
      <el-form-item label="同步间隔(秒)">
        <el-input-number v-model="form.syncIntervalSec" :min="0" :step="30" controls-position="right" />
        <span class="tip">0 表示使用全局设置（最小 30 秒）</span>
      </el-form-item>
      <el-form-item label="钉钉推送">
        <el-switch v-model="form.dingtalkEnabled" />
      </el-form-item>
      <el-form-item label="推送包含关键词">
        <el-input v-model="form.dingtalkInclude" placeholder="逗号分隔，留空表示全部" />
      </el-form-item>
      <el-form-item label="推送排除关键词">
        <el-input v-model="form.dingtalkExclude" placeholder="逗号分隔" />
      </el-form-item>

      <template v-if="editing">
        <el-divider content-position="left">文件夹同步</el-divider>
        <p class="hint">开启同步的文件夹会定时拉取新邮件（首次开启回填最新若干封）。</p>
        <div v-if="isMobile" class="folder-list" v-loading="foldersLoading">
          <div v-for="row in folders" :key="row.id" class="folder-item">
            <span class="folder-path">{{ row.path }}</span>
            <el-switch :model-value="row.syncEnabled" @change="(v) => toggleFolder(row, v)" />
          </div>
          <div v-if="!folders.length && !foldersLoading" class="folder-empty">暂无文件夹</div>
        </div>
        <el-table v-else :data="folders" v-loading="foldersLoading" max-height="240">
          <el-table-column prop="path" label="路径" min-width="200" />
          <el-table-column label="特殊用途" width="120">
            <template #default="{ row }">{{ row.specialUse || '-' }}</template>
          </el-table-column>
          <el-table-column label="邮件数" width="80">
            <template #default="{ row }">{{ row.total }}</template>
          </el-table-column>
          <el-table-column label="同步" width="80">
            <template #default="{ row }">
              <el-switch :model-value="row.syncEnabled" @change="(v) => toggleFolder(row, v)" />
            </template>
          </el-table-column>
        </el-table>
      </template>
    </el-form>
    </div>

    <template #footer>
      <el-button v-if="!isOauth" @click="test" :loading="testing">测试连接</el-button>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import api, { errMsg } from '../api.js';
import { useIsMobile } from '../composables/useIsMobile.js';

const emit = defineEmits(['saved']);

const visible = ref(false);
const isMobile = useIsMobile();
const editing = ref(null);
const saving = ref(false);
const testing = ref(false);
const folders = ref([]);
const foldersLoading = ref(false);

const isOauth = computed(() => editing.value?.authType === 'oauth2');
const dialogTitle = computed(() => {
  if (editing.value) return isOauth.value ? '编辑邮箱（OAuth 授权）' : '编辑邮箱';
  return '添加自定义邮箱（IMAP/SMTP）';
});

const form = reactive({
  name: '',
  senderName: '',
  email: '',
  username: '',
  password: '',
  imapHost: '',
  imapPort: 993,
  imapSecure: true,
  smtpHost: '',
  smtpPort: 465,
  smtpSecure: true,
  syncIntervalSec: 0,
  dingtalkEnabled: false,
  dingtalkInclude: '',
  dingtalkExclude: '',
});

function open(row) {
  editing.value = row;
  Object.assign(form, {
    name: row?.name || '',
    senderName: row?.senderName || '',
    email: row?.email || '',
    username: row?.username || '',
    password: '',
    imapHost: row?.imapHost || '',
    imapPort: row?.imapPort || 993,
    imapSecure: row ? Boolean(row.imapSecure) : true,
    smtpHost: row?.smtpHost || '',
    smtpPort: row?.smtpPort || 465,
    smtpSecure: row ? Boolean(row.smtpSecure) : true,
    syncIntervalSec: row?.syncIntervalSec || 0,
    dingtalkEnabled: Boolean(row?.dingtalkEnabled),
    dingtalkInclude: row?.dingtalkInclude || '',
    dingtalkExclude: row?.dingtalkExclude || '',
  });
  visible.value = true;
  loadFolders(row?.id);
}

async function loadFolders(id) {
  folders.value = [];
  if (!id) return;
  foldersLoading.value = true;
  try {
    const data = await api.get(`/mailboxes/${id}/folders`);
    if (editing.value?.id === id) folders.value = data.items;
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    if (editing.value?.id === id) foldersLoading.value = false;
  }
}

async function toggleFolder(row, enabled) {
  try {
    await api.put(`/mailboxes/${editing.value.id}/folders`, {
      folderId: row.id,
      syncEnabled: enabled,
    });
    row.syncEnabled = enabled;
    ElMessage.success(enabled ? '已开启同步' : '已关闭同步');
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

function validate() {
  if (!form.name.trim()) return '请填写名称';
  if (isOauth.value) return null;
  if (!form.email.trim()) return '请填写邮箱地址';
  if (!form.username.trim()) return '请填写登录账号';
  if (!form.imapHost.trim()) return '请填写 IMAP 服务器';
  if (!form.smtpHost.trim()) return '请填写 SMTP 服务器';
  if (!editing.value && !form.password) return '请填写密码/授权码';
  return null;
}

async function save() {
  const err = validate();
  if (err) return ElMessage.warning(err);
  saving.value = true;
  try {
    if (editing.value) {
      const payload = isOauth.value
        ? {
            name: form.name,
            senderName: form.senderName,
            syncIntervalSec: form.syncIntervalSec,
            dingtalkEnabled: form.dingtalkEnabled,
            dingtalkInclude: form.dingtalkInclude,
            dingtalkExclude: form.dingtalkExclude,
          }
        : { ...form };
      if (!isOauth.value && !payload.password) delete payload.password;
      await api.put(`/mailboxes/${editing.value.id}`, payload);
      ElMessage.success('已保存');
    } else {
      await api.post('/mailboxes', { ...form, provider: 'custom', authType: 'password' });
      ElMessage.success('已添加，可点击“同步”拉取邮件');
    }
    visible.value = false;
    emit('saved');
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    saving.value = false;
  }
}

async function test() {
  const err = validate();
  if (err) return ElMessage.warning(err);
  testing.value = true;
  try {
    const testConfig = {
      timeout: 180000,
      loadingLabel: '正在测试服务器连接，最长约需 1 分钟…',
    };
    let data;
    if (editing.value) {
      data = await api.post(`/mailboxes/${editing.value.id}/test`, null, testConfig);
    } else {
      data = await api.post(
        '/mailboxes/test',
        {
          ...form,
          provider: 'custom',
          authType: 'password',
        },
        testConfig
      );
    }
    if (data.imap.ok && data.smtp.ok) ElMessage.success('IMAP / SMTP 连接正常');
    else {
      if (!data.imap.ok) ElMessage.error(`IMAP 失败: ${data.imap.error}`);
      if (!data.smtp.ok) ElMessage.error(`SMTP 失败: ${data.smtp.error}`);
    }
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    testing.value = false;
  }
}

defineExpose({ open });
</script>

<style scoped>
.dialog-scroll {
  max-height: calc(100vh - 280px);
  overflow-y: auto;
}
.host-row {
  display: flex;
  gap: 10px;
  width: 100%;
  align-items: center;
}
.host-row .el-input {
  flex: 1;
}
.tip {
  font-size: 12px;
  color: #909399;
  margin-left: 8px;
}
.hint {
  font-size: 13px;
  color: #909399;
  margin: 0 0 10px;
}
.folder-list {
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  max-height: 240px;
  overflow-y: auto;
}
.folder-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
}
.folder-item + .folder-item {
  border-top: 1px solid #f2f6fc;
}
.folder-path {
  min-width: 0;
  word-break: break-all;
}
.folder-empty {
  padding: 16px;
  text-align: center;
  color: #909399;
  font-size: 13px;
}
@media (max-width: 767.98px) {
  .host-row {
    flex-wrap: wrap;
  }
  .host-row .el-input {
    flex: 1 1 100%;
  }
  .host-row .el-input-number {
    width: 100%;
  }
  .dialog-scroll {
    max-height: calc(100vh - 200px);
  }
}
</style>
