export function getInitialOnlineState() {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}
