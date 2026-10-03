<template>
  <div class="rich-editor">
    <div ref="editorEl"></div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);

const editorEl = ref(null);
let quill = null;
let updatingFromProp = false;

const TOOLBAR = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ color: [] }, { background: [] }],
  [{ list: 'ordered' }, { list: 'bullet' }, { indent: '-1' }, { indent: '+1' }, { align: [] }],
  ['blockquote', 'code-block'],
  ['link'],
  ['clean'],
];

const TOOLBAR_TITLES = {
  'ql-header': '标题级别',
  'ql-bold': '加粗 (Ctrl+B)',
  'ql-italic': '斜体 (Ctrl+I)',
  'ql-underline': '下划线 (Ctrl+U)',
  'ql-strike': '删除线',
  'ql-color': '字体颜色',
  'ql-background': '背景颜色',
  'ql-align': '对齐方式',
  'ql-blockquote': '引用',
  'ql-code-block': '代码块',
  'ql-link': '插入链接',
  'ql-clean': '清除格式',
};

function controlTitle(el) {
  if (el.classList.contains('ql-list')) {
    return el.value === 'ordered' ? '有序列表' : '无序列表';
  }
  if (el.classList.contains('ql-indent')) {
    return el.value === '-1' ? '减少缩进' : '增加缩进';
  }
  for (const cls of el.classList) {
    if (TOOLBAR_TITLES[cls]) return TOOLBAR_TITLES[cls];
  }
  return '';
}

function decorateToolbar() {
  const toolbar = editorEl.value?.parentElement?.querySelector('.ql-toolbar');
  if (!toolbar) return;
  toolbar.querySelectorAll('button, select').forEach((el) => {
    const title = controlTitle(el);
    if (!title) return;
    el.setAttribute('title', title);
    el.setAttribute('aria-label', title);
  });
}

function currentHtml() {
  return quill ? quill.getSemanticHTML() : '';
}

function setContent(html) {
  if (!quill) return;
  updatingFromProp = true;
  if (html) {
    const range = quill.getSelection();
    quill.clipboard.dangerouslyPasteHTML(html, 'silent');
    if (range) quill.setSelection(range, 'silent');
  } else {
    quill.setText('', 'silent');
  }
  updatingFromProp = false;
}

onMounted(() => {
  quill = new Quill(editorEl.value, {
    theme: 'snow',
    placeholder: props.placeholder,
    modules: { toolbar: TOOLBAR },
  });
  decorateToolbar();
  if (props.modelValue) setContent(props.modelValue);
  quill.on('text-change', (delta, oldDelta, source) => {
    if (updatingFromProp || source === 'silent') return;
    const html = currentHtml();
    if (html !== props.modelValue) emit('update:modelValue', html);
  });
});

watch(
  () => props.modelValue,
  (val) => {
    if (!quill || val === currentHtml()) return;
    setContent(val);
  }
);

onBeforeUnmount(() => {
  quill = null;
});

function getText() {
  return quill ? quill.getText().replace(/\n+$/, '') : '';
}

defineExpose({ getText });
</script>

<style scoped>
.rich-editor {
  width: 100%;
}
.rich-editor :deep(.ql-toolbar) {
  border-top-left-radius: 4px;
  border-top-right-radius: 4px;
  background: #fafafa;
}
.rich-editor :deep(.ql-toolbar .ql-formats) {
  margin-right: 0;
  padding: 0 6px;
  border-right: 1px solid #e4e7ed;
}
.rich-editor :deep(.ql-toolbar .ql-formats:first-child) {
  padding-left: 2px;
}
.rich-editor :deep(.ql-toolbar .ql-formats:last-child) {
  border-right: 0;
}
.rich-editor :deep(.ql-container) {
  border-bottom-left-radius: 4px;
  border-bottom-right-radius: 4px;
  font-size: 14px;
  min-height: 220px;
}
.rich-editor :deep(.ql-editor) {
  min-height: 200px;
  max-height: 420px;
  overflow-y: auto;
}
</style>
