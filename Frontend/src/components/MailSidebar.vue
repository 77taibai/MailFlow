<template>
  <div class="sidebar">
    <div class="brand">
      <el-icon :size="20"><Message /></el-icon>
      <span>MailFlow</span>
    </div>

    <!-- 一级：邮箱列表 -->
    <template v-if="view === 'mailboxes'">
      <div class="section-title">邮箱</div>
      <el-scrollbar class="list-scroll">
        <div
          class="mailbox-item"
          :class="{ active: mergedSelected }"
          @click="pickMerged"
        >
          <el-icon class="mb-icon"><Postcard /></el-icon>
          <span class="mb-name">合并账户</span>
          <el-badge v-if="mergedUnread" :value="mergedUnread" :max="99" />
        </div>
        <div
          v-for="mb in mailboxes"
          :key="mb.id"
          class="mailbox-item"
          :class="{ active: mb.id === selectedMailboxId }"
          @click="pickMailbox(mb.id)"
        >
          <span class="mb-name">{{ mb.name }}</span>
          <el-badge v-if="mb.unreadCount" :value="mb.unreadCount" :max="99" />
          <el-icon class="mb-go"><ArrowRight /></el-icon>
        </div>
        <div v-if="!mailboxes.length" class="empty-tip">
          暂无邮箱，<router-link to="/mailboxes">去添加</router-link>
        </div>
      </el-scrollbar>
    </template>

    <!-- 二级：当前邮箱的文件夹列表 -->
    <template v-else>
      <div class="submenu-header" @click="backToMailboxes">
        <el-icon><ArrowLeft /></el-icon>
        <span class="mb-name">{{ currentMailboxName }}</span>
      </div>
      <div class="section-title">文件夹</div>
      <el-scrollbar class="list-scroll">
        <div
          v-for="f in folders"
          :key="f.id"
          class="folder-item"
          :class="{ active: f.id === selectedFolderId }"
          @click="$emit('select-folder', f.id)"
        >
          <el-icon><Folder /></el-icon>
          <span class="folder-name">{{ folderDisplayName(f) }}</span>
          <el-badge v-if="f.unread" :value="f.unread" :max="99" />
        </div>
        <div v-if="!folders.length" class="empty-tip">暂无显示中的文件夹，可在邮箱管理 → 编辑 → 文件夹同步 中开启同步</div>
      </el-scrollbar>
    </template>

    <div class="sidebar-footer">
      <router-link to="/mailboxes"><el-button text>邮箱管理</el-button></router-link>
      <el-button text type="danger" @click="$emit('logout')">退出</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
  mailboxes: { type: Array, default: () => [] },
  mergedSelected: { type: Boolean, default: false },
  mergedUnread: { type: Number, default: 0 },
  selectedMailboxId: { type: Number, default: null },
  folders: { type: Array, default: () => [] },
  selectedFolderId: { type: Number, default: null },
});

const emit = defineEmits(['select-merged', 'select-mailbox', 'select-folder', 'logout']);

// 二级菜单视图：'mailboxes' 一级邮箱列表 / 'folders' 二级文件夹列表
const view = ref('mailboxes');

// 外部（如打开邮件定位到所属邮箱）切换邮箱时也进入二级视图，保持侧栏与当前上下文一致
watch(
  () => props.selectedMailboxId,
  (id) => {
    if (id) view.value = 'folders';
  }
);
watch(
  () => props.mergedSelected,
  (m) => {
    if (m) view.value = 'mailboxes';
  }
);

const currentMailboxName = computed(() => {
  const mb = props.mailboxes.find((m) => m.id === props.selectedMailboxId);
  return mb ? mb.name : '邮箱';
});

function pickMailbox(id) {
  emit('select-mailbox', id);
  view.value = 'folders';
}

function pickMerged() {
  emit('select-merged');
  view.value = 'mailboxes';
}

function backToMailboxes() {
  view.value = 'mailboxes';
}

function folderDisplayName(f) {
  if (f.specialUse === '\\Inbox' || f.path === 'INBOX') return '收件箱';
  if (f.specialUse === '\\Sent') return '已发送';
  if (f.specialUse === '\\Trash') return '已删除';
  if (f.specialUse === '\\Drafts') return '草稿箱';
  if (f.specialUse === '\\Junk') return '垃圾邮件';
  return f.path;
}
</script>

<style scoped>
.sidebar {
  border-right: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
  background: #f7f8fa;
  overflow: hidden;
  height: 100%;
  /* 列表为点击导航，禁止文字被选中 */
  user-select: none;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 17px;
  color: #2b4c6f;
  padding: 14px 16px 10px;
}
.section-title {
  font-size: 12px;
  color: #909399;
  padding: 8px 16px 4px;
}
.submenu-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 600;
  color: #2b4c6f;
  cursor: pointer;
  border-bottom: 1px solid #ebeef5;
}
.submenu-header:hover {
  background: #ecf5ff;
}
.mailbox-item,
.folder-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  cursor: pointer;
  font-size: 14px;
}
.mailbox-item:hover,
.folder-item:hover {
  background: #ecf5ff;
}
.mailbox-item.active,
.folder-item.active {
  background: #d9ecff;
}
.mb-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.folder-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mb-icon {
  color: #909399;
}
.mb-go {
  color: #c0c4cc;
  font-size: 12px;
}
.sidebar :deep(.el-scrollbar) {
  height: auto;
}
/* 一级、二级列表互斥显示，均可独占剩余全部高度 */
.list-scroll {
  flex: 1 1 0%;
  min-height: 0;
}
.empty-tip {
  font-size: 13px;
  color: #909399;
  padding: 6px 16px;
}
.sidebar-footer {
  border-top: 1px solid #e4e7ed;
  padding: 6px 8px;
  display: flex;
  justify-content: space-between;
}
@media (max-width: 767.98px) {
  .mailbox-item,
  .folder-item {
    min-height: 40px;
    padding-top: 10px;
    padding-bottom: 10px;
  }
}
</style>
