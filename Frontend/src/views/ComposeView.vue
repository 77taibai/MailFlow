<template>
  <div class="page">
    <h2 class="page-title">撰写邮件</h2>

    <el-alert
      v-if="!mailboxes.length"
      title="还没有可用的发件邮箱，请先到邮箱管理添加"
      type="warning"
      show-icon
      style="margin-bottom: 12px"
    />

    <el-form
      class="compose-form"
      :label-position="isMobile ? 'top' : 'right'"
      :label-width="isMobile ? 'auto' : '80px'"
      :disabled="!mailboxes.length"
    >
      <el-form-item label="发件邮箱">
        <el-select v-model="form.mailboxId" placeholder="选择发件邮箱" style="width: 100%">
          <el-option
            v-for="mb in mailboxes"
            :key="mb.id"
            :label="`${mb.name} (${mb.email})`"
            :value="mb.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="收件人">
        <tag-input v-model="form.to" placeholder="多个地址用空格分隔" />
      </el-form-item>
      <el-form-item label="抄送">
        <tag-input v-model="form.cc" placeholder="可选，多个地址用空格分隔" />
      </el-form-item>
      <el-form-item label="主题">
        <el-input v-model="form.subject" />
      </el-form-item>
      <el-form-item label="正文">
        <rich-text-editor ref="editorRef" v-model="form.html" placeholder="邮件正文" />
      </el-form-item>
      <el-form-item label="附件">
        <el-upload
          v-model:file-list="fileList"
          :auto-upload="false"
          multiple
          :limit="10"
          :on-exceed="() => ElMessage.warning('最多 10 个附件')"
        >
          <el-button :icon="Paperclip">添加附件</el-button>
          <template #tip>
            <div class="el-upload__tip">单个文件不超过 25MB</div>
          </template>
        </el-upload>
      </el-form-item>
    </el-form>

    <div class="form-actions">
      <el-button @click="cancel">取消</el-button>
      <el-button type="primary" :loading="sending" :disabled="!mailboxes.length" @click="send">
        发送
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Paperclip } from '@element-plus/icons-vue';
import api, { errMsg } from '../api.js';
import RichTextEditor from '../components/RichTextEditor.vue';
import TagInput from '../components/TagInput.vue';
import { useIsMobile } from '../composables/useIsMobile.js';

const route = useRoute();
const router = useRouter();
const isMobile = useIsMobile();
const mailboxes = ref([]);
const sending = ref(false);
const fileList = ref([]);
const editorRef = ref();
const form = reactive({ mailboxId: null, to: [], cc: [], subject: '', html: '' });

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatReplyDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('zh-CN');
}

function quoteHtml(replyMail) {
  const source = replyMail.bodyText || String(replyMail.bodyHtml || '').replace(/<[^>]*>/g, '');
  const quoted = escapeHtml(source.slice(0, 500)).replace(/\r?\n/g, '<br>');
  const date = escapeHtml(formatReplyDate(replyMail.date));
  const author = escapeHtml(replyMail.fromName || replyMail.fromAddr || '');
  return `<p></p><p>------------------</p><p>在 ${date}，${author} 写道:</p><blockquote>${quoted}</blockquote>`;
}

function selectMailbox(id) {
  if (id && mailboxes.value.some((m) => m.id === id)) {
    form.mailboxId = id;
    return true;
  }
  return false;
}

async function loadMailboxes() {
  try {
    const data = await api.get('/mailboxes');
    mailboxes.value = data.items || [];
    const preferred = Number(route.query.mailbox);
    if (!selectMailbox(preferred) && mailboxes.value.length) {
      form.mailboxId = mailboxes.value[0].id;
    }
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function loadReply(id) {
  try {
    const mail = await api.get(`/mails/${id}`);
    if (mail.mailboxId) selectMailbox(mail.mailboxId);
    form.to = mail.fromAddr ? [mail.fromAddr] : [];
    form.subject = mail.subject?.startsWith('Re:') ? mail.subject : `Re: ${mail.subject || ''}`;
    form.html = quoteHtml(mail);
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

function cancel() {
  router.push('/');
}

async function send() {
  if (!form.mailboxId) return ElMessage.warning('请选择发件邮箱');
  if (!form.to.length) return ElMessage.warning('请填写收件人');
  sending.value = true;
  try {
    const fd = new FormData();
    fd.append('mailboxId', form.mailboxId);
    fd.append('to', form.to.join(', '));
    fd.append('cc', form.cc.join(', '));
    fd.append('subject', form.subject);
    fd.append('html', form.html);
    fd.append('text', editorRef.value ? editorRef.value.getText() : '');
    for (const f of fileList.value) {
      fd.append('attachments', f.raw);
    }
    await api.post('/mails/send', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    ElMessage.success('发送成功');
    router.push('/');
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    sending.value = false;
  }
}

onMounted(async () => {
  await loadMailboxes();
  if (route.query.reply) await loadReply(route.query.reply);
});
</script>

<style scoped>
.page {
  max-width: 840px;
  margin: 0 auto;
  padding: 20px;
}
.page-title {
  margin: 0 0 16px;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}
@media (max-width: 767.98px) {
  .page {
    padding: 12px;
  }
  .form-actions {
    justify-content: stretch;
  }
  .form-actions .el-button {
    flex: 1;
  }
}
</style>
