import { useEffect, useRef, useState } from 'react'

/** 积压的字在这么多帧内吐完：积压越多吐得越快，网络一顿也不会一下蹦出一大段 */
const DRAIN_FRAMES = 14
/** 每帧至少吐出的字数（约 60 字/秒） */
const MIN_STEP = 1

/** 不在代理对中间截断，避免 emoji 等字符短暂显示成乱码 */
const safeEnd = (text: string, end: number) => {
  const code = text.charCodeAt(end - 1)
  return code >= 0xd800 && code <= 0xdbff ? end + 1 : end
}

/**
 * 流式输出时把一块块到达的文字匀速吐出来。
 * 输出结束（active 为 false）立即显示全部内容，不拖尾。
 */
export const useSmoothStream = (content: string, active: boolean) => {
  const [shown, setShown] = useState(active ? 0 : content.length)
  const shownRef = useRef(shown)
  const targetRef = useRef(content)
  /** 上一次的内容，用来发现内容被整体替换（重新生成、切换版本） */
  const previousRef = useRef(content)
  if (!content.startsWith(previousRef.current.slice(0, shownRef.current))) {
    shownRef.current = 0
  }
  previousRef.current = content
  targetRef.current = content

  useEffect(() => {
    if (!active) {
      return
    }
    let frame = 0
    const tick = () => {
      const target = targetRef.current
      const next0 = Math.min(shownRef.current, target.length)
      const backlog = target.length - next0
      if (backlog > 0) {
        const next = safeEnd(target, Math.min(target.length, next0 + Math.max(MIN_STEP, Math.ceil(backlog / DRAIN_FRAMES))))
        shownRef.current = next
        setShown(next)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active])

  if (!active) {
    shownRef.current = content.length
    return content
  }
  return content.slice(0, Math.min(shown, shownRef.current, content.length))
}
