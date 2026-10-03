import { onBeforeUnmount, ref } from 'vue';

export const MOBILE_QUERY = '(max-width: 767.98px)';

export function useIsMobile(query = MOBILE_QUERY) {
  const mq = window.matchMedia(query);
  const isMobile = ref(mq.matches);

  const handler = (e) => {
    isMobile.value = e.matches;
  };
  mq.addEventListener('change', handler);

  onBeforeUnmount(() => {
    mq.removeEventListener('change', handler);
  });

  return isMobile;
}
