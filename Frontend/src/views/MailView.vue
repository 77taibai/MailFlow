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
        <el-button class="compose-btn" type="primary" :icon="EditPen" size="small" :disabled="!mailboxes.length" @click="openCompose">
          撰写
        </el-button>
      </div>

      <mail-list
        ref="listRef"
        :mails="mails"
        :selected-ids="selectedIds"
        :active-mail-id="currentMail && currentMail.id"
        :loading="listLoading"
        :loading-older="loadingOlder"
        :loading-newer="loadingNewer"
        :has-more-older="hasMoreOlder"
        :has-more-newer="hasMoreNewer"
        @toggle="toggleSelect"
        @open="openMail"
        @load-older="loadOlder"
        @load-newer="loadNewer"
      />
    </el-main>

    <el-main class="reader-pane" v-show="!isMobile || currentMail">
      <div class="mobile-bar reader-back" v-if="isMobile && currentMail">
        <el-button :icon="ArrowLeft" text @click="closeMail" />
        <div class="reader-actions">
          <el-tooltip content="回复">
            <el-button :icon="EditPen" text @click="prefillReply(currentMail)" />
          </el-tooltip>
          <el-tooltip content="分享">
            <el-button :icon="Share" text @click="readerRef?.shareMail()" />
          </el-tooltip>
          <el-tooltip :content="currentMail.seen ? '标记未读' : '标记已读'">
            <el-button :icon="currentMail.seen ? View : Hide" text @click="readerRef?.toggleSeen()" />
          </el-tooltip>
          <el-tooltip content="删除">
            <el-button :icon="Delete" text type="danger" @click="readerRef?.deleteMail()" />
          </el-tooltip>
        </div>
      </div>
      <mail-reader ref="readerRef" :mail="currentMail" @refresh="resetMails" @reply="prefillReply" @deleted="onMailDeleted" />
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
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Refresh, EditPen, Menu, ArrowLeft, Share, Delete, View, Hide } from '@element-plus/icons-vue';
import api, { errMsg } from '../api.js';
import { useAuthStore } from '../stores/auth.js';
import { useIsMobile } from '../composables/useIsMobile.js';
import MailSidebar from '../components/MailSidebar.vue';
import MailList from '../components/MailList.vue';
import MailReader from '../components/MailReader.vue';

const route = useRoute();
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
const pageSize = 20;
const hasMoreOlder = ref(false);
const hasMoreNewer = ref(false);
const loadingOlder = ref(false);
const loadingNewer = ref(false);
const listRef = ref(null);
const readerRef = ref(null);
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
  clearRouteMail();
  mergedSelected.value = true;
  selectedMailboxId.value = null;
  selectedFolderId.value = null;
  folders.value = [];
  currentMail.value = null;
  selectedIds.value = [];
  resetMails();
}

function selectMailbox(id) {
  clearRouteMail();
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
      hasMoreOlder.value = false;
      hasMoreNewer.value = false;
      currentMail.value = null;
      selectedIds.value = [];
    }
  }
}

function selectFolder(id) {
  clearRouteMail();
  selectedFolderId.value = id;
  currentMail.value = null;
  selectedIds.value = [];
  resetMails();
}

function listQuery() {
  return mergedSelected.value
    ? { scope: 'merged-inbox' }
    : { mailboxId: selectedMailboxId.value, folderId: selectedFolderId.value };
}

function cursorOf(mail) {
  return `${Number(mail.date) || 0}:${mail.id}`;
}

async function resetMails() {
  listLoading.value = true;
  hasMoreOlder.value = false;
  hasMoreNewer.value = false;
  try {
    if (mergedSelected.value) {
      const data = await api.get('/mails', {
        params: { ...listQuery(), page: 1, pageSize },
      });
      mails.value = data.items;
      total.value = data.total;
      hasMoreOlder.value = data.total > data.items.length;
      if (listRef.value) listRef.value.scrollToTop();
      return;
    }
    if (!selectedMailboxId.value || !selectedFolderId.value) {
      mails.value = [];
      total.value = 0;
      return;
    }
    const data = await api.get('/mails', {
      params: { ...listQuery(), page: 1, pageSize },
    });
    mails.value = data.items;
    total.value = data.total;
    hasMoreOlder.value = data.total > data.items.length;
    if (listRef.value) listRef.value.scrollToTop();
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    listLoading.value = false;
  }
}

async function loadOlder() {
  if (listLoading.value || loadingOlder.value || !hasMoreOlder.value) return;
  const oldest = mails.value[mails.value.length - 1];
  if (!oldest) return;
  loadingOlder.value = true;
  try {
    const data = await api.get('/mails', {
      params: { ...listQuery(), before: cursorOf(oldest), pageSize },
    });
    const known = new Set(mails.value.map((m) => m.id));
    const fresh = data.items.filter((m) => !known.has(m.id));
    mails.value = mails.value.concat(fresh);
    hasMoreOlder.value = data.items.length === pageSize;
    if (data.total > total.value) hasMoreNewer.value = true;
    total.value = data.total;
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    loadingOlder.value = false;
  }
}

async function loadNewer() {
  if (listLoading.value || loadingNewer.value || !hasMoreNewer.value) return;
  const newest = mails.value[0];
  if (!newest) return;
  loadingNewer.value = true;
  const anchor = listRef.value ? listRef.value.getScrollInfo() : null;
  try {
    const data = await api.get('/mails', {
      params: { ...listQuery(), after: cursorOf(newest), pageSize },
    });
    const known = new Set(mails.value.map((m) => m.id));
    const fresh = data.items.filter((m) => !known.has(m.id));
    if (fresh.length) {
      mails.value = fresh.concat(mails.value);
      await nextTick();
      if (anchor && listRef.value) listRef.value.restoreScroll(anchor);
    }
    hasMoreNewer.value = data.items.length === pageSize;
    total.value = data.total;
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    loadingNewer.value = false;
  }
}

async function refreshAll() {
  await loadMailboxes();
  if (!mergedSelected.value) await loadFolders();
  await resetMails();
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

function clearRouteMail() {
  if (route.params.id && currentMail.value) router.replace({ name: 'mail' });
}

function closeMail() {
  if (route.params.id) router.replace({ name: 'mail' });
  else currentMail.value = null;
}

function openMail(mail) {
  if (Number(route.params.id) === mail.id) return;
  router.push({ name: 'mail', params: { id: String(mail.id) } });
}

let mailLoadSeq = 0;

async function loadMailById(id) {
  if (!Number.isInteger(id) || id <= 0) {
    currentMail.value = null;
    if (route.params.id) router.replace({ name: 'mail' });
    return;
  }
  const seq = ++mailLoadSeq;
  try {
    const data = await api.get(`/mails/${id}`);
    if (seq !== mailLoadSeq || Number(route.params.id) !== id) return;
    currentMail.value = data;
    if (!data.seen) {
      await api.patch(`/mails/${id}`, { seen: true });
      if (seq !== mailLoadSeq) return;
      data.seen = true;
      const row = mails.value.find((m) => m.id === id);
      if (row) row.seen = true;
      loadFolders();
      loadMailboxes();
    }
  } catch (e) {
    if (seq !== mailLoadSeq) return;
    ElMessage.error(errMsg(e));
    if (route.params.id) router.replace({ name: 'mail' });
  }
}

watch(
  () => route.params.id,
  (id) => {
    if (id === undefined || id === null || id === '') {
      mailLoadSeq += 1;
      currentMail.value = null;
      return;
    }
    loadMailById(Number(id));
  },
  { immediate: true }
);

async function batchSeen(seen) {
  try {
    await api.post('/mails/batch', { ids: [...selectedIds.value], action: seen ? 'seen' : 'unseen' });
    ElMessage.success('已更新');
    selectedIds.value = [];
    await resetMails();
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
  if (route.params.id) router.replace({ name: 'mail' });
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
  // 点邮箱进入二级（文件夹列表），窄屏下保持抽屉打开以便继续选文件夹
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
.reader-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
}
.reader-actions .el-button {
  margin-left: 0;
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
    flex-wrap: nowrap;
    gap: 4px;
    padding: 8px 6px;
  }
  .list-toolbar > .spacer {
    display: none;
  }
  .list-toolbar > .el-button {
    --el-button-size: 32px;
    flex: 1 1 0;
    min-width: 0;
    padding: 0 4px;
    font-size: 12px;
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
