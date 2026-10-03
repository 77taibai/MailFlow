<template>
  <div class="sidebar">
    <div class="brand">
      <el-icon :size="20"><Message /></el-icon>
      <span>MailFlow</span>
    </div>

    <div class="section-title">邮箱</div>
    <el-scrollbar max-height="180px">
      <div
        class="mailbox-item"
        :class="{ active: mergedSelected }"
        @click="$emit('select-merged')"
      >
        <span class="mb-name">合并账户</span>
        <el-badge v-if="mergedUnread" :value="mergedUnread" :max="99" />
      </div>
      <div
        v-for="mb in mailboxes"
        :key="mb.id"
        class="mailbox-item"
        :class="{ active: mb.id === selectedMailboxId }"
        @click="$emit('select-mailbox', mb.id)"
      >
        <span class="mb-name">{{ mb.name }}</span>
        <el-badge v-if="mb.unreadCount" :value="mb.unreadCount" :max="99" />
      </div>
      <div v-if="!mailboxes.length" class="empty-tip">
        暂无邮箱，<router-link to="/mailboxes">去添加</router-link>
      </div>
    </el-scrollbar>

    <div class="section-title">文件夹</div>
    <el-scrollbar class="folder-scroll">
      <div v-if="mergedSelected" class="folder-item active">
        <el-icon><Folder /></el-icon>
        <span class="folder-name">收件箱</span>
      </div>
      <template v-else>
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
      </template>
    </el-scrollbar>

    <div class="sidebar-footer">
      <router-link to="/mailboxes"><el-button text>邮箱管理</el-button></router-link>
      <el-button text type="danger" @click="$emit('logout')">退出</el-button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  mailboxes: { type: Array, default: () => [] },
  mergedSelected: { type: Boolean, default: false },
  mergedUnread: { type: Number, default: 0 },
  selectedMailboxId: { type: Number, default: null },
  folders: { type: Array, default: () => [] },
  selectedFolderId: { type: Number, default: null },
});

defineEmits(['select-merged', 'select-mailbox', 'select-folder', 'logout']);

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
.sidebar :deep(.el-scrollbar) {
  height: auto;
}
.folder-scroll {
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
