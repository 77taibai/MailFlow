<template>
  <div class="share-page">
    <header class="share-bar">
      <el-icon :size="20"><Message /></el-icon>
      <span>MailFlow 分享</span>
    </header>

    <div v-if="loading" class="share-state">加载中…</div>
    <el-empty v-else-if="error" class="share-state" :description="error" />

    <div v-else-if="mail" class="share-reader">
      <div class="share-header">
        <h3 class="subject">{{ mail.subject || '(无主题)' }}</h3>
        <div class="meta">
          <span class="from">
            <b>{{ mail.fromName || '' }}</b>
            {{ mail.fromAddr ? `<${mail.fromAddr}>` : '' }}
          </span>
          <span class="date">{{ formatDateTime(mail.date) }}</span>
        </div>
        <div class="meta to" v-if="mail.toList">收件人: {{ mail.toList }}</div>
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
      <div class="share-body">
        <iframe
          v-if="mail.bodyHtml"
          class="html-frame"
          sandbox="allow-popups"
          :srcdoc="mail.bodyHtml"
        ></iframe>
        <pre v-else class="text-body">{{ mail.bodyText }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { shareApi } from '../api.js';
import { formatDateTime, formatBytes } from '../utils.js';

const route = useRoute();
const mail = ref(null);
const error = ref('');
const loading = ref(true);

function currentToken() {
  return String(route.params.token || '');
}

async function load() {
  loading.value = true;
  error.value = '';
  mail.value = null;
  try {
    mail.value = await shareApi.get(`/share/${encodeURIComponent(currentToken())}`);
  } catch (e) {
    error.value = e?.response?.data?.error || '分享链接无效或已过期';
  } finally {
    loading.value = false;
  }
}

watch(currentToken, load, { immediate: true });

function download(att) {
  const link = document.createElement('a');
  link.href = `/api/share/${encodeURIComponent(currentToken())}/attachments/${att.id}`;
  link.download = att.filename || 'attachment';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
</script>

<style scoped>
.share-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
}
.share-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #e4e7ed;
  font-weight: 600;
  font-size: 16px;
  color: #2b4c6f;
  flex-shrink: 0;
}
.share-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #909399;
  padding: 40px 16px;
}
.share-reader {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.share-header {
  padding: 14px 18px;
  border-bottom: 1px solid #e4e7ed;
  flex-shrink: 0;
}
.subject {
  margin: 0;
  font-size: 17px;
  word-break: break-word;
}
.meta {
  font-size: 13px;
  color: #606266;
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
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
.share-body {
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
  .share-header {
    padding: 10px 12px;
  }
  .text-body {
    padding: 12px;
  }
}
</style>
