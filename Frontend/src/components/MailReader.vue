<template>
  <div class="reader" v-loading="!!readerBusy" :element-loading-text="readerBusyText">
    <template v-if="mail">
      <div class="reader-header">
        <div class="subject-line">
          <h3 class="subject">{{ mail.subject || '(无主题)' }}</h3>
          <div class="actions">
            <el-tooltip content="回复">
              <el-button :icon="EditPen" text :disabled="!!readerBusy" @click="$emit('reply', mail)" />
            </el-tooltip>
            <el-tooltip content="分享">
              <el-button :icon="Share" text :loading="readerBusy === 'share'" :disabled="!!readerBusy && readerBusy !== 'share'" @click="shareMail" />
            </el-tooltip>
            <el-tooltip :content="mail.seen ? '标记未读' : '标记已读'">
              <el-button :icon="mail.seen ? View : Hide" text :loading="readerBusy === 'seen'" :disabled="!!readerBusy && readerBusy !== 'seen'" @click="toggleSeen" />
            </el-tooltip>
            <el-tooltip content="删除">
              <el-button :icon="Delete" text type="danger" :loading="readerBusy === 'delete'" :disabled="!!readerBusy && readerBusy !== 'delete'" @click="deleteMail" />
            </el-tooltip>
          </div>
        </div>
        <div class="meta">
          <span class="from"><b>{{ mail.fromName || '' }}</b> {{ mail.fromAddr ? `<${mail.fromAddr}>` : '' }}</span>
          <span class="date">{{ formatDateTime(mail.date) }}</span>
        </div>
        <div
          class="meta to"
          v-if="mail.senderAddr && mail.senderAddr.toLowerCase() !== String(mail.fromAddr || '').toLowerCase()"
        >
          发送者: <b>{{ mail.senderName || '' }}</b> {{ `<${mail.senderAddr}>` }}
        </div>
        <div class="meta to" v-if="mail.replyToAddr">
          回复至: <b>{{ mail.replyToName || '' }}</b> {{ `<${mail.replyToAddr}>` }}
        </div>
        <div class="meta to" v-if="mail.toList">收件人: {{ mail.toList }}</div>
        <div class="meta to" v-if="mail.ccList">抄送: {{ mail.ccList }}</div>
        <div class="attachments" v-if="mail.attachments && mail.attachments.length">
          <div class="att-title">附件 ({{ mail.attachments.length }})</div>
          <div class="att-list">
            <el-tag
              v-for="att in mail.attachments"
              :key="att.id"
              class="att-tag"
              @click="download(att)"
            >
              <el-icon class="is-loading" v-if="downloadingIds.has(att.id)"><Loading /></el-icon>
              <el-icon v-else><Paperclip /></el-icon>
              {{ att.filename }} ({{ formatBytes(att.size) }})
            </el-tag>
          </div>
        </div>
      </div>
      <div class="reader-body">
        <iframe
          v-if="mail.bodyHtml"
          class="html-frame"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          :srcdoc="safeBodyHtml"
        ></iframe>
        <pre v-else class="text-body">{{ mail.bodyText }}</pre>
      </div>
    </template>
    <el-empty v-else description="选择一封邮件查看" />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { EditPen, Delete, View, Hide, Share } from '@element-plus/icons-vue';
import api, { downloadToBlob, errMsg } from '../api.js';
import { formatDateTime, formatBytes, prepareMailHtml } from '../utils.js';

const props = defineProps({
  mail: { type: Object, default: null },
});

const emit = defineEmits(['refresh', 'reply', 'deleted']);

// 正文链接统一在新标签打开，避免在 iframe 内导航顶掉正文
const safeBodyHtml = computed(() => prepareMailHtml(props.mail?.bodyHtml));

// '' | 'seen' | 'delete' | 'share'
const readerBusy = ref('');
const readerBusyText = ref('');
// 正在下载的附件 id 集合
const downloadingIds = ref(new Set());

async function runBusy(key, text, fn) {
  if (readerBusy.value) return;
  readerBusy.value = key;
  readerBusyText.value = text;
  try {
    await fn();
  } finally {
    readerBusy.value = '';
    readerBusyText.value = '';
  }
}

async function toggleSeen() {
  const next = !props.mail.seen;
  await runBusy('seen', next ? '正在标记已读…' : '正在标记未读…', async () => {
    try {
      const data = await api.patch(
        `/mails/${props.mail.id}`,
        { seen: next },
        { loadingLabel: '正在同步已读状态到服务器…', timeout: 120000 }
      );
      props.mail.seen = next;
      emit('refresh');
      if (data && data.warning) ElMessage.warning(`本地已更新，服务器同步失败：${data.warning}`);
    } catch (e) {
      ElMessage.error(errMsg(e));
    }
  });
}

async function deleteMail() {
  if (readerBusy.value) return;
  try {
    await ElMessageBox.confirm('确定删除这封邮件吗？', '删除', { type: 'warning' });
  } catch {
    return;
  }
  await runBusy('delete', '正在删除邮件…', async () => {
    try {
      const data = await api.post(
        '/mails/batch',
        { ids: [props.mail.id], action: 'delete' },
        { loadingLabel: '正在删除邮件并同步到服务器…', timeout: 120000 }
      );
      if (Array.isArray(data.warnings) && data.warnings.length) {
        ElMessage.warning(`已本地删除，服务器同步失败：${data.warnings[0]}`);
      } else {
        ElMessage.success('已删除');
      }
      emit('deleted');
    } catch (e) {
      ElMessage.error(errMsg(e));
    }
  });
}

async function shareMail() {
  await runBusy('share', '正在生成分享链接…', async () => {
    try {
      const data = await api.post(`/mails/${props.mail.id}/share`, null, {
        loadingLabel: '正在生成分享链接…',
      });
      const url = new URL(data.path, window.location.origin).href;
      try {
        await navigator.clipboard.writeText(url);
        ElMessage.success('分享链接已复制');
      } catch {
        await ElMessageBox.alert(url, '分享链接', { confirmButtonText: '关闭' });
      }
    } catch (e) {
      ElMessage.error(errMsg(e));
    }
  });
}

async function download(att) {
  if (downloadingIds.value.has(att.id)) return;
  const set = new Set(downloadingIds.value);
  set.add(att.id);
  downloadingIds.value = set;
  try {
    await downloadToBlob(`/mails/${props.mail.id}/attachments/${att.id}`, att.filename);
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    const done = new Set(downloadingIds.value);
    done.delete(att.id);
    downloadingIds.value = done;
  }
}

defineExpose({ shareMail, toggleSeen, deleteMail });
</script>

<style scoped>
.reader {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.reader-header {
  padding: 14px 18px;
  border-bottom: 1px solid #e4e7ed;
  flex-shrink: 0;
}
.subject-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.subject {
  margin: 0;
  font-size: 17px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.actions {
  flex-shrink: 0;
}
.meta {
  font-size: 13px;
  color: #606266;
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.meta.to {
  display: block;
  color: #909399;
}
.attachments {
  margin-top: 10px;
}
.att-title {
  font-size: 12px;
  color: #909399;
  margin-bottom: 6px;
}
.att-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.att-tag {
  cursor: pointer;
}
.reader-body {
  flex: 1;
  overflow: hidden;
  display: flex;
}
.html-frame {
  flex: 1;
  border: 0;
  width: 100%;
  height: 100%;
}
.text-body {
  flex: 1;
  margin: 0;
  padding: 16px 18px;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 14px;
  color: #303133;
  overflow: auto;
}
@media (max-width: 767.98px) {
  .reader-header {
    padding: 10px 12px;
  }
  .subject-line {
    align-items: flex-start;
  }
  .subject {
    white-space: normal;
  }
  .meta {
    flex-wrap: wrap;
  }
  .text-body {
    padding: 12px;
  }
  .actions {
    display: none;
  }
}
</style>
