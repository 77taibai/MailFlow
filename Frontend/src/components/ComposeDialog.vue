<template>
  <el-dialog v-model="visible" title="撰写邮件" width="760px" :close-on-click-modal="false">
    <el-form label-width="70px">
      <el-form-item label="发件邮箱">
        <el-select v-model="form.mailboxId" placeholder="选择发件邮箱" style="width: 100%">
          <el-option v-for="mb in mailboxes" :key="mb.id" :label="`${mb.name} (${mb.email})`" :value="mb.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="收件人">
        <el-input v-model="form.to" placeholder="多个地址用逗号分隔" />
      </el-form-item>
      <el-form-item label="抄送">
        <el-input v-model="form.cc" placeholder="可选" />
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
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="sending" @click="send">发送</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Paperclip } from '@element-plus/icons-vue';
import api, { errMsg } from '../api.js';
import RichTextEditor from './RichTextEditor.vue';

const props = defineProps({
  mailboxes: { type: Array, default: () => [] },
});

const emit = defineEmits(['sent']);

const visible = ref(false);
const sending = ref(false);
const fileList = ref([]);
const editorRef = ref();
const form = reactive({ mailboxId: null, to: '', cc: '', subject: '', html: '' });

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function quoteHtml(replyMail) {
  const source = replyMail.bodyText || String(replyMail.bodyHtml || '').replace(/<[^>]*>/g, '');
  const quoted = escapeHtml(source.slice(0, 500)).replace(/\r?\n/g, '<br>');
  const date = escapeHtml(formatReplyDate(replyMail.date));
  const author = escapeHtml(replyMail.fromName || replyMail.fromAddr || '');
  return `<p></p><p>------------------</p><p>在 ${date}，${author} 写道:</p><blockquote>${quoted}</blockquote>`;
}

function open(replyMail) {
  form.mailboxId = props.mailboxes.length ? props.mailboxes[0].id : null;
  form.to = '';
  form.cc = '';
  form.subject = '';
  form.html = '';
  fileList.value = [];
  if (replyMail) {
    form.to = replyMail.fromAddr || '';
    form.subject = replyMail.subject?.startsWith('Re:') ? replyMail.subject : `Re: ${replyMail.subject || ''}`;
    form.html = quoteHtml(replyMail);
  }
  visible.value = true;
}

function formatReplyDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('zh-CN');
}

async function send() {
  if (!form.mailboxId) return ElMessage.warning('请选择发件邮箱');
  if (!form.to.trim()) return ElMessage.warning('请填写收件人');
  sending.value = true;
  try {
    const fd = new FormData();
    fd.append('mailboxId', form.mailboxId);
    fd.append('to', form.to);
    fd.append('cc', form.cc);
    fd.append('subject', form.subject);
    fd.append('html', form.html);
    fd.append('text', editorRef.value ? editorRef.value.getText() : '');
    for (const f of fileList.value) {
      fd.append('attachments', f.raw);
    }
    await api.post('/mails/send', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    ElMessage.success('发送成功');
    visible.value = false;
    emit('sent');
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    sending.value = false;
  }
}

defineExpose({ open });
</script>
