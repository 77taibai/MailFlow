<template>
  <div class="page" v-loading="initLoading" element-loading-text="正在加载…">
    <h2 class="page-title">撰写邮件</h2>

    <el-alert
      v-if="!initLoading && !mailboxes.length"
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
      <el-button :disabled="sending || initLoading" @click="cancel">取消</el-button>
      <el-button type="primary" :loading="sending" :disabled="!mailboxes.length || initLoading" @click="send">
        {{ sending ? sendProgressText : '发送' }}
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
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
const initLoading = ref(false);
const uploadPercent = ref(0);
const sendStage = ref(''); // 'uploading' | 'sending'
const sendProgressText = computed(() => {
  if (sendStage.value === 'uploading' && uploadPercent.value > 0) {
    return uploadPercent.value < 100 ? `上传附件 ${uploadPercent.value}%` : '发送中…';
  }
  return '发送中…';
});
const fileList = ref([]);
const editorRef = ref();
const form = reactive({ mailboxId: null, to: [], cc: [], subject: '', html: '', inReplyTo: '', references: [] });

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
    const data = await api.get('/mailboxes', { loadingLabel: '正在加载发件邮箱…' });
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
    const mail = await api.get(`/mails/${id}`, { loadingLabel: '正在加载原邮件…' });
    if (mail.mailboxId) selectMailbox(mail.mailboxId);
    const replyTarget = mail.replyToAddr || mail.fromAddr;
    form.to = replyTarget ? [replyTarget] : [];
    form.subject = mail.subject?.startsWith('Re:') ? mail.subject : `Re: ${mail.subject || ''}`;
    const references = Array.isArray(mail.references) ? [...mail.references] : [];
    if (mail.messageId && !references.includes(mail.messageId)) references.push(mail.messageId);
    form.inReplyTo = mail.messageId || '';
    form.references = references;
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
  uploadPercent.value = 0;
  sendStage.value = fileList.value.length ? 'uploading' : 'sending';
  try {
    const fd = new FormData();
    fd.append('mailboxId', form.mailboxId);
    fd.append('to', form.to.join(', '));
    fd.append('cc', form.cc.join(', '));
    fd.append('subject', form.subject);
    fd.append('html', form.html);
    fd.append('text', editorRef.value ? editorRef.value.getText() : '');
    if (form.inReplyTo) fd.append('inReplyTo', form.inReplyTo);
    if (form.references.length) fd.append('references', JSON.stringify(form.references));
    for (const f of fileList.value) {
      fd.append('attachments', f.raw);
    }
    await api.post('/mails/send', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      loadingLabel: '正在发送邮件…',
      // SMTP 外发可能较慢，附件大时上传 + 投递合计可能几分钟
      timeout: 300000,
      onUploadProgress: (e) => {
        if (e.total) uploadPercent.value = Math.round((e.loaded * 100) / e.total);
        if (uploadPercent.value >= 100) sendStage.value = 'sending';
      },
    });
    ElMessage.success('发送成功');
    router.push('/');
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    sending.value = false;
    uploadPercent.value = 0;
    sendStage.value = '';
  }
}

onMounted(async () => {
  initLoading.value = true;
  try {
    await loadMailboxes();
    if (route.query.reply) await loadReply(route.query.reply);
  } finally {
    initLoading.value = false;
  }
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
