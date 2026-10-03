<template>
  <div class="tag-input" :class="{ 'is-focused': focused }" @click="onContainerClick">
    <template v-for="(tag, i) in modelValue" :key="`${i}-${tag}`">
      <input
        v-if="editingIndex === i"
        ref="editInputEl"
        v-model="editValue"
        class="tag-edit-input"
        :style="{ width: editWidth }"
        @click.stop
        @keydown.enter.prevent="commitEdit"
        @keydown.esc.prevent="cancelEdit"
        @blur="commitEdit"
      />
      <el-tag
        v-else
        class="tag-item"
        closable
        :disable-transitions="true"
        @close="removeAt(i)"
      >
        <span class="tag-text" @click.stop="startEdit(i)">{{ tag }}</span>
      </el-tag>
    </template>
    <input
      ref="inputEl"
      v-model="draft"
      class="tag-entry"
      :placeholder="modelValue.length ? '' : placeholder"
      @keydown="onKeydown"
      @paste="onPaste"
      @focus="focused = true"
      @blur="onBlur"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  placeholder: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);

const draft = ref('');
const focused = ref(false);
const editingIndex = ref(-1);
const editValue = ref('');
const inputEl = ref(null);
const editInputEl = ref(null);

const editWidth = computed(() => `${Math.max(80, editValue.value.length * 9 + 28)}px`);

function splitTokens(text) {
  return String(text)
    .split(/[\s,;，；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function addTokens(tokens) {
  if (!tokens.length) return;
  const seen = new Set(props.modelValue.map((t) => t.toLowerCase()));
  const add = [];
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    add.push(token);
  }
  if (add.length) emit('update:modelValue', [...props.modelValue, ...add]);
}

function commitDraft() {
  const tokens = splitTokens(draft.value);
  draft.value = '';
  addTokens(tokens);
}

function removeAt(index) {
  const next = props.modelValue.slice();
  next.splice(index, 1);
  if (editingIndex.value === index) editingIndex.value = -1;
  else if (editingIndex.value > index) editingIndex.value -= 1;
  emit('update:modelValue', next);
}

function startEdit(index) {
  editingIndex.value = index;
  editValue.value = props.modelValue[index];
}

function commitEdit() {
  const index = editingIndex.value;
  if (index < 0) return;
  const value = editValue.value.trim();
  const next = props.modelValue.slice();
  if (!value) next.splice(index, 1);
  else next[index] = value;
  editingIndex.value = -1;
  emit('update:modelValue', next);
}

function cancelEdit() {
  editingIndex.value = -1;
}

function onKeydown(e) {
  if (e.isComposing) return;
  const key = e.key;
  if (key === ' ' || key === ',' || key === '，' || key === ';' || key === '；' || key === 'Enter') {
    e.preventDefault();
    commitDraft();
    return;
  }
  if (key === 'Backspace' && !draft.value && props.modelValue.length) {
    removeAt(props.modelValue.length - 1);
  }
}

function onPaste(e) {
  const text = e.clipboardData?.getData('text') || '';
  if (!/[\s,;，；]/.test(text)) return;
  e.preventDefault();
  addTokens(splitTokens(`${draft.value} ${text}`));
  draft.value = '';
}

function onBlur() {
  focused.value = false;
  commitDraft();
}

function onContainerClick() {
  inputEl.value?.focus();
}

watch(editingIndex, async (index) => {
  if (index < 0) return;
  await nextTick();
  const el = Array.isArray(editInputEl.value) ? editInputEl.value[0] : editInputEl.value;
  el?.focus();
  el?.select();
});

defineExpose({ focus: () => inputEl.value?.focus() });
</script>

<style scoped>
.tag-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 32px;
  padding: 1px 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-fill-color-blank);
  cursor: text;
  transition: border-color 0.2s;
}
.tag-input.is-focused {
  border-color: var(--el-color-primary);
}
.tag-item {
  margin: 0;
  max-width: 100%;
}
.tag-text {
  cursor: text;
}
.tag-entry {
  flex: 1 1 120px;
  min-width: 120px;
  height: 28px;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 14px;
  color: var(--el-text-color-regular);
}
.tag-entry::placeholder {
  color: var(--el-text-color-placeholder);
}
.tag-edit-input {
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--el-color-primary);
  border-radius: 4px;
  outline: 0;
  font-size: 12px;
  color: var(--el-text-color-regular);
}
</style>
