<template>
  <div class="reader">
    <template v-if="mail">
      <div class="reader-header">
        <div class="subject-line">
          <h3 class="subject">{{ mail.subject || '(无主题)' }}</h3>
          <div class="actions">
            <el-tooltip content="回复">
              <el-button :icon="EditPen" text @click="$emit('reply', mail)" />
            </el-tooltip>
            <el-tooltip content="分享">
              <el-button :icon="Share" text @click="shareMail" />
            </el-tooltip>
            <el-tooltip :content="mail.seen ? '标记未读' : '标记已读'">
              <el-button :icon="mail.seen ? View : Hide" text @click="toggleSeen" />
            </el-tooltip>
            <el-tooltip content="删除">
              <el-button :icon="Delete" text type="danger" @click="deleteMail" />
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
              <el-icon><Paperclip /></el-icon>
              {{ att.filename }} ({{ formatBytes(att.size) }})
            </el-tag>
          </div>
        </div>
      </div>
      <div class="reader-body">
        <iframe
          v-if="mail.bodyHtml"
          class="html-frame"
          sandbox="allow-popups"
          :srcdoc="mail.bodyHtml"
        ></iframe>
        <pre v-else class="text-body">{{ mail.bodyText }}</pre>
      </div>
    </template>
    <el-empty v-else description="选择一封邮件查看" />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { EditPen, Delete, View, Hide, Share } from '@element-plus/icons-vue';
import api, { downloadToBlob, errMsg } from '../api.js';
import { formatDateTime, formatBytes } from '../utils.js';

const props = defineProps({
  mail: { type: Object, default: null },
});

const emit = defineEmits(['refresh', 'reply', 'deleted']);

async function toggleSeen() {
  try {
    await api.patch(`/mails/${props.mail.id}`, { seen: !props.mail.seen });
    props.mail.seen = !props.mail.seen;
    emit('refresh');
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function deleteMail() {
  try {
    await ElMessageBox.confirm('确定删除这封邮件吗？', '删除', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api.post('/mails/batch', { ids: [props.mail.id], action: 'delete' });
    ElMessage.success('已删除');
    emit('deleted');
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function shareMail() {
  try {
    const data = await api.post(`/mails/${props.mail.id}/share`);
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
}

async function download(att) {
  try {
    await downloadToBlob(`/mails/${props.mail.id}/attachments/${att.id}`, att.filename);
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}
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
}
</style>
