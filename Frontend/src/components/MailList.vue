<template>
  <el-scrollbar ref="scrollbarRef" v-loading="loading" class="mail-list" @scroll="onScroll">
    <div v-if="loadingNewer" class="load-more">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>正在加载较新邮件…</span>
    </div>
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
    <div v-if="loadingOlder" class="load-more">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>正在加载较早邮件…</span>
    </div>
    <div v-else-if="mails.length && !hasMoreOlder" class="load-end">没有更多邮件了</div>
  </el-scrollbar>
</template>

<script setup>
import { ref } from 'vue';
import { formatDate } from '../utils.js';

const props = defineProps({
  mails: { type: Array, default: () => [] },
  selectedIds: { type: Array, default: () => [] },
  activeMailId: { type: Number, default: null },
  loading: { type: Boolean, default: false },
  loadingOlder: { type: Boolean, default: false },
  loadingNewer: { type: Boolean, default: false },
  hasMoreOlder: { type: Boolean, default: false },
  hasMoreNewer: { type: Boolean, default: false },
});

const emit = defineEmits(['toggle', 'open', 'load-older', 'load-newer']);

const scrollbarRef = ref(null);

const NEAR_TOP = 32;
const NEAR_BOTTOM = 96;

function wrapEl() {
  const w = scrollbarRef.value?.wrapRef;
  if (!w) return null;
  return w.value || w;
}

function onScroll({ scrollTop }) {
  const wrap = wrapEl();
  if (!wrap) return;
  const max = wrap.scrollHeight - wrap.clientHeight;
  if (scrollTop <= NEAR_TOP) {
    if (props.hasMoreNewer && !props.loadingNewer && !props.loading) emit('load-newer');
    return;
  }
  if (max - scrollTop <= NEAR_BOTTOM) {
    if (props.hasMoreOlder && !props.loadingOlder && !props.loading) emit('load-older');
  }
}

function getScrollInfo() {
  const wrap = wrapEl();
  return wrap ? { scrollTop: wrap.scrollTop, scrollHeight: wrap.scrollHeight } : null;
}

function restoreScroll(anchor) {
  if (!anchor) return;
  const wrap = wrapEl();
  if (!wrap) return;
  const delta = wrap.scrollHeight - anchor.scrollHeight;
  if (delta !== 0) scrollbarRef.value?.setScrollTop(anchor.scrollTop + delta);
}

function scrollToTop() {
  scrollbarRef.value?.setScrollTop(0);
}

defineExpose({ getScrollInfo, restoreScroll, scrollToTop });
</script>

<style scoped>
.mail-list {
  flex: 1;
  /* 列表为点击导航，禁止文字被选中 */
  user-select: none;
}
.mail-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  cursor: pointer;
}
.mail-row:hover {
  background: var(--el-fill-color-light);
}
.mail-row.selected {
  background: var(--el-color-primary-light-9);
}
.mail-row.active {
  background: var(--el-color-primary-light-8);
  box-shadow: inset 3px 0 0 var(--el-color-primary);
}
.mail-row.active .from,
.mail-row.active .subject {
  color: var(--mf-brand-text);
  font-weight: 600;
}
.mail-row.active .snippet {
  color: var(--el-text-color-secondary);
}
.mail-row .from,
.mail-row .subject {
  color: var(--el-text-color-secondary);
}
.mail-row.unread .from,
.mail-row.unread .subject {
  color: var(--el-text-color-primary);
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
  color: var(--el-text-color-disabled);
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
  color: var(--el-color-warning);
  flex-shrink: 0;
}
.mb-tag {
  flex-shrink: 0;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--el-text-color-secondary);
}
.mb-tag :deep(.el-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.snippet {
  font-size: 12px;
  color: var(--el-text-color-disabled);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.load-more,
.load-end {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
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
