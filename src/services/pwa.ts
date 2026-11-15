/** PWA 壳：注册 Service Worker，并尽量申请持久存储。 */
export const setupPwa = () => {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('./sw.js').catch(() => {
        // file:// 或非 HTTPS 环境下注册失败是预期行为。
      })
    })
  }
  if (navigator.storage && typeof navigator.storage.persist === 'function') {
    void navigator.storage.persist().catch(() => {})
  }
}
