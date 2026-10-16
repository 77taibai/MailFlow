<template>
  <div class="rich-editor" :class="{ 'is-fullscreen': fullscreen }">
    <div class="editor-bar">
      <el-button text size="small" :icon="fullscreen ? Close : FullScreen" @click="toggleFullscreen">
        {{ fullscreen ? '退出全屏' : '全屏' }}
      </el-button>
    </div>
    <div ref="editorEl"></div>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Quill from 'quill';
import { FullScreen, Close } from '@element-plus/icons-vue';
import 'quill/dist/quill.snow.css';

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);

const editorEl = ref(null);
const fullscreen = ref(false);
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

function toggleFullscreen() {
  fullscreen.value = !fullscreen.value;
  document.body.style.overflow = fullscreen.value ? 'hidden' : '';
  if (fullscreen.value) nextTick(() => quill?.focus());
}

function onKeydown(e) {
  if (e.key === 'Escape' && fullscreen.value) toggleFullscreen();
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
  window.addEventListener('keydown', onKeydown);
});

watch(
  () => props.modelValue,
  (val) => {
    if (!quill || val === currentHtml()) return;
    setContent(val);
  }
);

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  document.body.style.overflow = '';
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
.editor-bar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 2px;
}
.rich-editor :deep(.ql-toolbar) {
  border-top-left-radius: 4px;
  border-top-right-radius: 4px;
  background: var(--el-fill-color-lighter);
  /* 外层 el-form-item__content 的 line-height:32px 会继承进工具栏，
     抬高 .ql-picker-label 的行盒基线，使“Normal”等文字比右侧图标偏下；
     重置为 normal 以还原 Quill 默认的垂直居中 */
  line-height: normal;
}
.rich-editor :deep(.ql-toolbar .ql-formats) {
  margin-right: 0;
  padding: 0 6px;
  border-right: 1px solid var(--el-border-color-light);
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
.rich-editor.is-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: var(--el-bg-color);
}
.rich-editor.is-fullscreen .editor-bar {
  flex: none;
  margin-bottom: 8px;
}
.rich-editor.is-fullscreen :deep(.ql-toolbar) {
  flex: none;
}
.rich-editor.is-fullscreen :deep(.ql-container) {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.rich-editor.is-fullscreen :deep(.ql-editor) {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
  overflow-y: auto;
}
@media (max-width: 767.98px) {
  .rich-editor :deep(.ql-editor) {
    min-height: 160px;
    max-height: none;
  }
  .rich-editor :deep(.ql-container) {
    min-height: 180px;
  }
  .rich-editor :deep(.ql-toolbar .ql-formats) {
    border-right: 0;
    padding: 0 4px;
  }
}

/* Quill snow 主题自带硬编码颜色（#444 图标 / #ccc 边框 / #fff 面板），
   深色下会不可见，这里随主题覆盖 */
html.dark .rich-editor :deep(.ql-toolbar),
html.dark .rich-editor :deep(.ql-container.ql-snow) {
  border-color: var(--el-border-color);
}
html.dark .rich-editor :deep(.ql-snow .ql-stroke) {
  stroke: var(--el-text-color-regular);
}
html.dark .rich-editor :deep(.ql-snow .ql-fill),
html.dark .rich-editor :deep(.ql-snow .ql-stroke.ql-fill) {
  fill: var(--el-text-color-regular);
}
html.dark .rich-editor :deep(.ql-snow .ql-picker) {
  color: var(--el-text-color-regular);
}
html.dark .rich-editor :deep(.ql-snow .ql-picker-options) {
  background-color: var(--el-bg-color-overlay);
  border-color: var(--el-border-color);
}
html.dark .rich-editor :deep(.ql-editor.ql-blank::before) {
  color: var(--el-text-color-placeholder);
}
html.dark .rich-editor :deep(.ql-snow .ql-editor code),
html.dark .rich-editor :deep(.ql-snow .ql-editor .ql-code-block-container) {
  background-color: var(--el-fill-color);
}
html.dark .rich-editor :deep(.ql-snow .ql-editor blockquote) {
  border-left-color: var(--el-border-color);
}
html.dark .rich-editor :deep(.ql-snow .ql-tooltip) {
  background-color: var(--el-bg-color-overlay);
  border-color: var(--el-border-color);
  color: var(--el-text-color-regular);
  box-shadow: var(--el-box-shadow-light);
}
</style>
