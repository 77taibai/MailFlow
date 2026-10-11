<template>
  <Teleport to="body">
    <Transition name="glb-fade">
      <div v-if="globalLoading.visible" class="global-loading" role="status" aria-live="polite">
        <div class="glb-track">
          <div class="glb-bar"></div>
        </div>
        <div class="glb-pill">
          <el-icon class="is-loading" :size="14"><Loading /></el-icon>
          <span class="glb-label">{{ globalLoading.label }}</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { Loading } from '@element-plus/icons-vue';
import { globalLoading } from '../composables/useGlobalLoading.js';
</script>

<style scoped>
.global-loading {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  /* 非阻塞：仅做感知提示，不拦截任何点击 */
  pointer-events: none;
}
.glb-track {
  height: 3px;
  width: 100%;
  background: rgba(64, 158, 255, 0.18);
  overflow: hidden;
}
.glb-bar {
  height: 100%;
  width: 35%;
  border-radius: 2px;
  background: linear-gradient(90deg, #409eff, #79bbff, #409eff);
  animation: glb-slide 1.1s ease-in-out infinite;
}
.glb-pill {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 80vw;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  color: #303133;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
}
.glb-label {
  overflow: hidden;
  text-overflow: ellipsis;
}
@keyframes glb-slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(385%);
  }
}
.glb-fade-enter-active,
.glb-fade-leave-active {
  transition: opacity 0.2s ease;
}
.glb-fade-enter-from,
.glb-fade-leave-to {
  opacity: 0;
}
</style>
