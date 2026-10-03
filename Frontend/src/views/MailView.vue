<template>
  <el-container class="mail-page">
    <el-aside v-if="!isMobile" width="250px" class="sidebar">
      <mail-sidebar
        :mailboxes="mailboxes"
        :merged-selected="mergedSelected"
        :merged-unread="mergedUnread"
        :selected-mailbox-id="selectedMailboxId"
        :folders="folders"
        :selected-folder-id="selectedFolderId"
        @select-merged="selectMerged"
        @select-mailbox="selectMailbox"
        @select-folder="selectFolder"
        @logout="logout"
      />
    </el-aside>

    <el-main class="list-pane" v-show="!isMobile || !currentMail">
      <div class="mobile-bar" v-if="isMobile">
        <el-button :icon="Menu" text @click="sidebarOpen = true" />
        <span class="mobile-title">{{ contextTitle }}</span>
        <el-button type="primary" :icon="EditPen" :disabled="!mailboxes.length" @click="openCompose">
          撰写
        </el-button>
      </div>
      <div class="list-toolbar">
        <el-button :icon="Refresh" size="small" :loading="syncing" :disabled="!selectedMailboxId && !mergedSelected" @click="syncNow">
          同步
        </el-button>
        <el-button size="small" :disabled="!selectedIds.length" @click="batchSeen(true)">标记已读</el-button>
        <el-button size="small" :disabled="!selectedIds.length" @click="batchSeen(false)">标记未读</el-button>
        <el-button size="small" :disabled="!selectedIds.length || mergedSelected" @click="moveDialogVisible = true">移动</el-button>
        <el-button size="small" type="danger" :disabled="!selectedIds.length" @click="batchDelete">删除</el-button>
        <div class="spacer"></div>
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="prev, pager, next"
          small
          @current-change="loadMails"
        />
        <el-button class="compose-btn" type="primary" :icon="EditPen" size="small" :disabled="!mailboxes.length" @click="openCompose">
          撰写
        </el-button>
      </div>

      <mail-list
        :mails="mails"
        :selected-ids="selectedIds"
        :active-mail-id="currentMail && currentMail.id"
        :loading="listLoading"
        @toggle="toggleSelect"
        @open="openMail"
      />
    </el-main>

    <el-main class="reader-pane" v-show="!isMobile || currentMail">
      <div class="mobile-bar reader-back" v-if="isMobile && currentMail">
        <el-button :icon="ArrowLeft" text @click="currentMail = null" />
      </div>
      <mail-reader :mail="currentMail" @refresh="loadMails" @reply="prefillReply" @deleted="onMailDeleted" />
    </el-main>

    <el-drawer
      v-model="sidebarOpen"
      direction="ltr"
      size="80%"
      :with-header="false"
      class="mail-drawer"
    >
      <mail-sidebar
        :mailboxes="mailboxes"
        :merged-selected="mergedSelected"
        :merged-unread="mergedUnread"
        :selected-mailbox-id="selectedMailboxId"
        :folders="folders"
        :selected-folder-id="selectedFolderId"
        @select-merged="onSelectMerged"
        @select-mailbox="onSelectMailbox"
        @select-folder="onSelectFolder"
        @logout="onLogout"
      />
    </el-drawer>

    <el-dialog v-model="moveDialogVisible" title="移动到文件夹" width="360px">
      <el-select v-model="moveTarget" placeholder="选择目标文件夹" style="width: 100%">
        <el-option
          v-for="f in folders.filter((f) => f.id !== selectedFolderId)"
          :key="f.id"
          :label="folderDisplayName(f)"
          :value="f.id"
        />
      </el-select>
      <template #footer>
        <el-button @click="moveDialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!moveTarget" @click="batchMove">确定</el-button>
      </template>
    </el-dialog>
  </el-container>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Refresh, EditPen, Menu, ArrowLeft } from '@element-plus/icons-vue';
import api, { errMsg } from '../api.js';
import { useAuthStore } from '../stores/auth.js';
import { useIsMobile } from '../composables/useIsMobile.js';
import MailSidebar from '../components/MailSidebar.vue';
import MailList from '../components/MailList.vue';
import MailReader from '../components/MailReader.vue';

const router = useRouter();
const auth = useAuthStore();
const isMobile = useIsMobile();

const mailboxes = ref([]);
const mergedSelected = ref(true);
const mergedUnread = ref(0);
const selectedMailboxId = ref(null);
const folders = ref([]);
const selectedFolderId = ref(null);
const mails = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const selectedIds = ref([]);
const currentMail = ref(null);
const listLoading = ref(false);
const syncing = ref(false);
const moveDialogVisible = ref(false);
const moveTarget = ref(null);
const sidebarOpen = ref(false);

watch(isMobile, (mobile) => {
  if (!mobile) sidebarOpen.value = false;
});

const contextTitle = computed(() => {
  if (mergedSelected.value) return '合并账户';
  const mb = mailboxes.value.find((m) => m.id === selectedMailboxId.value);
  if (!mb) return '';
  const f = folders.value.find((x) => x.id === selectedFolderId.value);
  return f ? `${mb.name} / ${folderDisplayName(f)}` : mb.name;
});

function folderDisplayName(f) {
  if (f.specialUse === '\\Inbox' || f.path === 'INBOX') return '收件箱';
  if (f.specialUse === '\\Sent') return '已发送';
  if (f.specialUse === '\\Trash') return '已删除';
  if (f.specialUse === '\\Drafts') return '草稿箱';
  if (f.specialUse === '\\Junk') return '垃圾邮件';
  return f.path;
}

async function loadMailboxes() {
  const data = await api.get('/mailboxes');
  mailboxes.value = data.items;
  mergedUnread.value = data.mergedUnread || 0;
  if (mergedSelected.value) return;
  if (!selectedMailboxId.value && data.items.length) {
    selectMailbox(data.items[0].id);
  } else if (selectedMailboxId.value) {
    const cur = data.items.find((m) => m.id === selectedMailboxId.value);
    if (!cur && data.items.length) selectMailbox(data.items[0].id);
  }
}

function selectMerged() {
  mergedSelected.value = true;
  selectedMailboxId.value = null;
  selectedFolderId.value = null;
  folders.value = [];
  currentMail.value = null;
  selectedIds.value = [];
  page.value = 1;
  loadMails();
}

function selectMailbox(id) {
  mergedSelected.value = false;
  selectedMailboxId.value = id;
  selectedFolderId.value = null;
  currentMail.value = null;
  selectedIds.value = [];
  loadFolders();
}

async function loadFolders() {
  if (mergedSelected.value || !selectedMailboxId.value) return;
  const data = await api.get(`/mailboxes/${selectedMailboxId.value}/folders`);
  folders.value = data.items.filter((f) => f.syncEnabled);
  const current = folders.value.find((f) => f.id === selectedFolderId.value);
  if (!current) {
    const inbox = folders.value.find((f) => f.specialUse === '\\Inbox' || f.path === 'INBOX');
    const first = inbox || folders.value[0];
    if (first) {
      selectFolder(first.id);
    } else {
      selectedFolderId.value = null;
      mails.value = [];
      total.value = 0;
      currentMail.value = null;
      selectedIds.value = [];
    }
  }
}

function selectFolder(id) {
  selectedFolderId.value = id;
  page.value = 1;
  currentMail.value = null;
  selectedIds.value = [];
  loadMails();
}

async function loadMails() {
  listLoading.value = true;
  try {
    if (mergedSelected.value) {
      const data = await api.get('/mails', {
        params: { scope: 'merged-inbox', page: page.value, pageSize },
      });
      mails.value = data.items;
      total.value = data.total;
      return;
    }
    if (!selectedMailboxId.value || !selectedFolderId.value) return;
    const data = await api.get('/mails', {
      params: {
        mailboxId: selectedMailboxId.value,
        folderId: selectedFolderId.value,
        page: page.value,
        pageSize,
      },
    });
    mails.value = data.items;
    total.value = data.total;
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    listLoading.value = false;
  }
}

async function refreshAll() {
  await loadMailboxes();
  if (!mergedSelected.value) await loadFolders();
  await loadMails();
}

async function syncNow() {
  if (mergedSelected.value) {
    if (!mailboxes.value.length) return;
    syncing.value = true;
    try {
      await Promise.all(mailboxes.value.map((mb) => api.post(`/mailboxes/${mb.id}/sync`)));
      ElMessage.success('已触发全部邮箱同步');
      setTimeout(refreshAll, 3000);
    } catch (e) {
      ElMessage.error(errMsg(e));
    } finally {
      syncing.value = false;
    }
    return;
  }
  if (!selectedMailboxId.value) return;
  syncing.value = true;
  try {
    await api.post(`/mailboxes/${selectedMailboxId.value}/sync`);
    ElMessage.success('同步已触发');
    setTimeout(refreshAll, 3000);
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    syncing.value = false;
  }
}

function toggleSelect(id, checked) {
  if (checked) {
    if (!selectedIds.value.includes(id)) selectedIds.value.push(id);
  } else {
    selectedIds.value = selectedIds.value.filter((v) => v !== id);
  }
}

async function openMail(mail) {
  try {
    const data = await api.get(`/mails/${mail.id}`);
    currentMail.value = data;
    if (!mail.seen) {
      mail.seen = true;
      await api.patch(`/mails/${mail.id}`, { seen: true });
      loadFolders();
      loadMailboxes();
    }
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function batchSeen(seen) {
  try {
    await api.post('/mails/batch', { ids: [...selectedIds.value], action: seen ? 'seen' : 'unseen' });
    ElMessage.success('已更新');
    selectedIds.value = [];
    await loadMails();
    loadFolders();
    loadMailboxes();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function batchMove() {
  moveDialogVisible.value = false;
  try {
    await api.post('/mails/batch', {
      ids: [...selectedIds.value],
      action: 'move',
      folderId: moveTarget.value,
    });
    ElMessage.success('已移动');
    selectedIds.value = [];
    moveTarget.value = null;
    currentMail.value = null;
    await refreshAll();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function batchDelete() {
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selectedIds.value.length} 封邮件吗？`, '删除', {
      type: 'warning',
    });
  } catch {
    return;
  }
  try {
    await api.post('/mails/batch', { ids: [...selectedIds.value], action: 'delete' });
    ElMessage.success('已删除');
    selectedIds.value = [];
    currentMail.value = null;
    await refreshAll();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

function openCompose() {
  if (mergedSelected.value) {
    router.push('/compose');
    return;
  }
  router.push({ path: '/compose', query: { mailbox: selectedMailboxId.value } });
}

function prefillReply(mail) {
  const query = { reply: mail.id };
  if (!mergedSelected.value && selectedMailboxId.value) query.mailbox = selectedMailboxId.value;
  router.push({ path: '/compose', query });
}

async function onMailDeleted() {
  currentMail.value = null;
  await refreshAll();
}

function logout() {
  auth.logout();
  router.replace('/login');
}

function onSelectMerged() {
  selectMerged();
  sidebarOpen.value = false;
}

function onSelectMailbox(id) {
  selectMailbox(id);
  sidebarOpen.value = false;
}

function onSelectFolder(id) {
  selectFolder(id);
  sidebarOpen.value = false;
}

function onLogout() {
  logout();
}

onMounted(() => {
  auth.fetchMe();
  loadMailboxes();
  selectMerged();
});
</script>

<style scoped>
.mail-page {
  height: 100%;
  overflow: hidden;
}
.list-pane {
  border-right: 1px solid #e4e7ed;
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-width: 460px;
  min-width: 360px;
  flex: 0 0 400px;
}
.mobile-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid #e4e7ed;
}
.mobile-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.list-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid #e4e7ed;
  flex-wrap: wrap;
}
.spacer {
  flex: 1;
}
.reader-pane {
  padding: 0;
  overflow: hidden;
}
@media (max-width: 767.98px) {
  .list-pane {
    max-width: none;
    min-width: 0;
    width: 100%;
    flex: 1 1 auto;
    border-right: none;
  }
  .reader-pane {
    width: 100%;
  }
  .list-toolbar {
    flex-wrap: wrap;
  }
  .compose-btn {
    display: none;
  }
}
</style>

<style>
.mail-drawer .el-drawer__body {
  padding: 0;
}
.mail-drawer .sidebar {
  height: 100%;
}
</style>
