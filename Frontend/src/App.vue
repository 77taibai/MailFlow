<template>
  <router-view />
  <global-loading-bar />
</template>

<script setup>
import GlobalLoadingBar from './components/GlobalLoadingBar.vue';
</script>

<style>
*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body,
#app {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow-x: hidden;
  font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif;
}
</style>
