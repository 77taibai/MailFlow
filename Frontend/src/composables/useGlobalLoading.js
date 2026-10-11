import { reactive } from 'vue';

/**
 * 全局请求加载总线：
 * - 任意耗时 API 请求 / 路由 chunk 加载都可通过 beginRequest/endRequest 注册；
 * - 超过延迟阈值（SHOW_DELAY）才显示，避免快速请求闪烁；
 * - 显示后保证最短展示时长（MIN_SHOW），让快速完成的慢请求也有可感知反馈；
 * - 非阻塞式设计（配合顶栏进度条 + 提示胶囊），用户仍可浏览页面其他内容。
 */
const SHOW_DELAY = 300;
const MIN_SHOW = 500;

export const globalLoading = reactive({
  visible: false,
  label: '',
  pending: 0,
});

let seq = 0;
const active = new Map(); // id -> label
let showTimer = null;
let hideTimer = null;
let shownAt = 0;

function refreshLabel() {
  const first = active.values().next();
  globalLoading.label = first.done ? '' : first.value;
}

export function beginRequest(label = '加载中…') {
  const id = ++seq;
  active.set(id, label);
  globalLoading.pending = active.size;
  refreshLabel();
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (!globalLoading.visible && showTimer === null) {
    showTimer = setTimeout(() => {
      showTimer = null;
      if (active.size > 0) {
        shownAt = Date.now();
        globalLoading.visible = true;
        refreshLabel();
      }
    }, SHOW_DELAY);
  }
  return id;
}

export function endRequest(id) {
  if (id != null && active.delete(id)) {
    globalLoading.pending = active.size;
    refreshLabel();
  }
  if (active.size === 0) {
    if (showTimer !== null) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    if (globalLoading.visible && hideTimer === null) {
      const remain = Math.max(0, MIN_SHOW - (Date.now() - shownAt));
      hideTimer = setTimeout(() => {
        hideTimer = null;
        if (active.size === 0) globalLoading.visible = false;
      }, remain);
    }
  }
}

/**
 * 包裹一个异步任务并挂到全局进度条上，用法：withGlobalLoading('正在同步…', fn)
 */
export async function withGlobalLoading(label, task) {
  const id = beginRequest(label);
  try {
    return await task();
  } finally {
    endRequest(id);
  }
}
