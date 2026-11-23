/** 主输入框被点按或聚焦时广播，正在编辑的已发送消息据此退出编辑，避免两个输入框同时处于编辑态 */
const EVENT = 'ds:composer-engaged'

export const notifyComposerEngaged = () => {
  window.dispatchEvent(new Event(EVENT))
}

export const onComposerEngaged = (handler: () => void) => {
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
