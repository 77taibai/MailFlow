<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="640px"
    :close-on-click-modal="false"
  >
    <el-alert
      v-if="isOauth"
      type="info"
      :closable="false"
      style="margin-bottom: 14px"
      title="该邮箱通过 OAuth 授权接入，服务器与凭据由系统自动管理；如需更换账号，请删除后重新授权。"
    />

    <el-form label-width="110px">
      <el-form-item label="名称" required>
        <el-input v-model="form.name" placeholder="显示名称" />
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
    </el-form>

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

const emit = defineEmits(['saved']);

const visible = ref(false);
const editing = ref(null);
const saving = ref(false);
const testing = ref(false);

const isOauth = computed(() => editing.value?.authType === 'oauth2');
const dialogTitle = computed(() => {
  if (editing.value) return isOauth.value ? '编辑邮箱（OAuth 授权）' : '编辑邮箱';
  return '添加自定义邮箱（IMAP/SMTP）';
});

const form = reactive({
  name: '',
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
    let data;
    if (editing.value) {
      data = await api.post(`/mailboxes/${editing.value.id}/test`);
    } else {
      data = await api.post('/mailboxes/test', {
        ...form,
        provider: 'custom',
        authType: 'password',
      });
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
</style>
