<template>
  <el-dialog v-model="visible" :title="`文件夹 — ${mailbox?.name || ''}`" width="520px">
    <p class="hint">开启同步的文件夹会定时拉取新邮件（首次开启回填最新若干封）。</p>
    <el-table :data="folders" v-loading="loading" max-height="420">
      <el-table-column prop="path" label="路径" min-width="200" />
      <el-table-column label="特殊用途" width="120">
        <template #default="{ row }">{{ row.specialUse || '-' }}</template>
      </el-table-column>
      <el-table-column label="邮件数" width="80">
        <template #default="{ row }">{{ row.total }}</template>
      </el-table-column>
      <el-table-column label="同步" width="80">
        <template #default="{ row }">
          <el-switch :model-value="row.syncEnabled" @change="(v) => toggle(row, v)" />
        </template>
      </el-table-column>
    </el-table>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import api, { errMsg } from '../api.js';

const emit = defineEmits(['saved']);

const visible = ref(false);
const loading = ref(false);
const mailbox = ref(null);
const folders = ref([]);

async function open(row) {
  mailbox.value = row;
  visible.value = true;
  loading.value = true;
  try {
    const data = await api.get(`/mailboxes/${row.id}/folders`);
    folders.value = data.items;
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    loading.value = false;
  }
}

async function toggle(row, enabled) {
  try {
    await api.put(`/mailboxes/${mailbox.value.id}/folders`, {
      folderId: row.id,
      syncEnabled: enabled,
    });
    row.syncEnabled = enabled;
    ElMessage.success(enabled ? '已开启同步' : '已关闭同步');
    emit('saved');
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

defineExpose({ open });
</script>

<style scoped>
.hint {
  font-size: 13px;
  color: #909399;
  margin-top: 0;
}
</style>
