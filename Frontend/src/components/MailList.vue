<template>
  <el-scrollbar v-loading="loading" class="mail-list">
    <div
      v-for="m in mails"
      :key="m.id"
      class="mail-row"
      :class="{ unread: !m.seen, selected: selectedIds.includes(m.id), active: activeMailId === m.id }"
      @click="$emit('open', m)"
    >
      <el-checkbox
        :model-value="selectedIds.includes(m.id)"
        @click.stop
        @change="(v) => $emit('toggle', m.id, v)"
      />
      <div class="row-main">
        <div class="row-line1">
          <span class="from">{{ m.from_name || m.from_addr || '(未知发件人)' }}</span>
          <span class="date">{{ formatDate(m.date) }}</span>
        </div>
        <div class="row-line2">
          <span class="subject">{{ m.subject || '(无主题)' }}</span>
          <el-icon v-if="m.has_attachments" :size="14" class="clip"><Paperclip /></el-icon>
          <el-tag v-if="m.mailbox_name" size="small" class="mb-tag" :title="m.mailbox_name">
            {{ m.mailbox_name }}
          </el-tag>
        </div>
        <div class="snippet">{{ m.snippet }}</div>
      </div>
    </div>
    <el-empty v-if="!loading && !mails.length" description="暂无邮件，点击上方“同步”拉取" />
  </el-scrollbar>
</template>

<script setup>
import { formatDate } from '../utils.js';

defineProps({
  mails: { type: Array, default: () => [] },
  selectedIds: { type: Array, default: () => [] },
  activeMailId: { type: Number, default: null },
  loading: { type: Boolean, default: false },
});

defineEmits(['toggle', 'open']);
</script>

<style scoped>
.mail-list {
  flex: 1;
}
.mail-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
}
.mail-row:hover {
  background: #f5f7fa;
}
.mail-row.selected {
  background: #ecf5ff;
}
.mail-row.active {
  background: #d9ecff;
  box-shadow: inset 3px 0 0 #409eff;
}
.mail-row.active .from,
.mail-row.active .subject {
  color: #2b4c6f;
  font-weight: 600;
}
.mail-row.active .snippet {
  color: #909399;
}
.mail-row .from,
.mail-row .subject {
  color: #909399;
}
.mail-row.unread .from,
.mail-row.unread .subject {
  color: #303133;
  font-weight: 600;
}
.row-main {
  flex: 1;
  min-width: 0;
}
.row-line1 {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}
.from {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.date {
  flex-shrink: 0;
  color: #c0c4cc;
  font-size: 12px;
}
.row-line2 {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
}
.subject {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.clip {
  color: #e6a23c;
  flex-shrink: 0;
}
.mb-tag {
  flex-shrink: 0;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #909399;
}
.mb-tag :deep(.el-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.snippet {
  font-size: 12px;
  color: #c0c4cc;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 767.98px) {
  .mail-row {
    padding: 10px;
  }
  .mb-tag {
    max-width: 72px;
  }
}
</style>
